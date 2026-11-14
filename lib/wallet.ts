import { adminDb } from "./firebaseAdmin";
import type { WalletDoc, WalletItem, WalletPerp } from "./types";
import { walletTotals } from "./walletMath";
import { isEvmAddress, isSolAddress, walletAddresses, walletKey } from "./addresses";
import { readSolana } from "./solana";

// Carteira on-chain (so leitura, pelo endereco publico; nunca usa chave privada):
//   Zerion  = saldos e posicoes DeFi em todas as redes EVM (chave gratuita em ZERION_API_KEY)
//   Lighter = conta de perpetuos, API publica sem chave
const ZERION = "https://api.zerion.io/v1";
const LIGHTER = "https://mainnet.zklighter.elliot.ai/api/v1";
// Atualiza no maximo a cada 30 min pelo agendador (48 chamadas/dia; o plano gratuito da Zerion aguenta folgado)
const AUTO_INTERVAL_MS = 30 * 60_000;

// Classe do ativo para comparar com a estrategia
export function assetClass(symbol: string): WalletItem["cls"] {
  const s = symbol.toUpperCase();
  if (/USD|GHO|DAI|USDT|FRAX|LUSD|PYUSD/.test(s)) return "stable";
  if (/^(W|ST|WST|R|CB|E|WE)?ETH$|^WEETH$|^RETH$/.test(s)) return "ETH";
  if (/^(W|CB|T|LB)?BTC$/.test(s)) return "BTC";
  if (/^(W)?SOL$/.test(s)) return "SOL";
  return "outro";
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// Vencimento de tokens com data no nome (ex.: PT-reUSD-10DEC2026 do Pendle)
export function maturityOf(name: string): number | null {
  const m = name.toUpperCase().match(/(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})/);
  return m ? Date.UTC(Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1])) : null;
}

type ZerionPosition = {
  attributes: {
    name: string;
    position_type: string;
    quantity: { float: number };
    value: number | null;
    fungible_info?: { symbol?: string; name?: string };
    application_metadata?: { name?: string } | null;
    protocol?: string | null;
    flags?: { is_trash?: boolean };
  };
  relationships?: { chain?: { data?: { id?: string } }; fungible?: { data?: { id?: string } } };
};

// Lucro/prejuizo da Zerion so a cada 6 h (o endpoint tem cota menor no plano gratuito); o botao forca
const PNL_INTERVAL_MS = 6 * 3_600_000;
// Depois de um limite (429), espera 3 h; o botao so forca de novo se a ultima tentativa tiver mais de 10 min
const PNL_THROTTLE_MS = 3 * 3_600_000;
const PNL_MIN_GAP_MS = 10 * 60_000;
const zerionAuth = () => {
  const key = process.env.ZERION_API_KEY;
  if (!key) throw new Error("ZERION_API_KEY nao configurada");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
};

type PnlStats = { net_invested?: number; unrealized_gain?: number; realized_gain?: number; average_buy_price?: number };

// Custo investido e lucro de cada token que voce tem (FIFO da Zerion): uma chamada por carteira com todos os tokens
// (filter[fungible_ids], ate 100), lendo data.attributes.breakdown.by_id. Na primeira consulta de uma carteira a Zerion
// responde 503 com Retry-After enquanto prepara o historico: tenta de novo algumas vezes.
async function zerionPnl(items: WalletItem[]): Promise<{ pnl: NonNullable<WalletDoc["pnl"]>; errors: string[]; throttled: boolean }> {
  const auth = zerionAuth();
  const out: NonNullable<WalletDoc["pnl"]> = {};
  const errors: string[] = [];
  let throttled = false;
  const byOwner = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.fungibleId || !i.owner || i.cls === "stable" || i.value < 1 || i.type === "loan") continue;
    byOwner.set(i.owner, (byOwner.get(i.owner) ?? new Set()).add(i.fungibleId));
  }
  for (const [owner, ids] of byOwner) {
    const url = `${ZERION}/wallets/${owner}/pnl?currency=usd&filter[fungible_ids]=${[...ids].slice(0, 100).join(",")}`;
    let res: Response | null = null;
    // No maximo ~15 s de espera por carteira (o "Atualizar tudo" tem 60 s no total)
    // 503 = preparando o historico; 429 = limite por segundo ou da cota do dia. Novas tentativas curtas (~15 s no maximo).
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url, { headers: { accept: "application/json", authorization: auth }, cache: "no-store" });
      if ((res.status !== 503 && res.status !== 429) || attempt === 3) break;
      if (res.status === 429 && attempt >= 1) break; // segundo 429: e a cota, nao adianta insistir
      const wait = Math.min(5, Number(res.headers.get("retry-after")) || (res.status === 429 ? 2 : 3));
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    const tag = `${owner.slice(0, 6)}...${owner.slice(-4)}`;
    if (!res || !res.ok) {
      const body = res ? (await res.text()).slice(0, 160) : "";
      if (res?.status === 429) throttled = true;
      errors.push(res?.status === 503
        ? `${tag}: a Zerion ainda esta preparando o historico; tente "Atualizar tudo" de novo em alguns minutos`
        : res?.status === 429
          ? `${tag}: limite de consultas da Zerion (plano gratuito) atingido; o site tenta de novo sozinho em 3 h e mantem o ultimo preco medio conhecido`
          : `${tag}: Zerion respondeu HTTP ${res?.status} ${body}`);
      continue;
    }
    const body = (await res.json()) as { data?: { attributes?: { breakdown?: { by_id?: Record<string, PnlStats> } } } };
    const byId = body.data?.attributes?.breakdown?.by_id ?? {};
    for (const [id, st] of Object.entries(byId)) {
      const cur = out[id] ?? { netInvested: 0, unrealized: 0, realized: 0, avgBuy: 0 };
      cur.netInvested += st.net_invested ?? 0;
      cur.unrealized += st.unrealized_gain ?? 0;
      cur.realized += st.realized_gain ?? 0;
      if (st.average_buy_price) cur.avgBuy = st.average_buy_price;
      out[id] = cur;
    }
    if (!Object.keys(byId).length) errors.push(`${tag}: a Zerion nao devolveu historico de compra para os tokens desta carteira`);
  }
  return { pnl: out, errors, throttled };
}

async function zerion(address: string): Promise<WalletItem[]> {
  const auth = zerionAuth();
  let url: string | null =
    `${ZERION}/wallets/${address}/positions/?filter[positions]=no_filter&filter[trash]=only_non_trash&currency=usd&sort=value`;
  const items: WalletItem[] = [];
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, { headers: { accept: "application/json", authorization: auth }, cache: "no-store" });
    if (res.status === 202) throw new Error("a Zerion ainda esta indexando a carteira; tente de novo em 1 minuto");
    if (!res.ok) throw new Error(`Zerion respondeu HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { data: ZerionPosition[]; links?: { next?: string } };
    for (const p of body.data) {
      const a = p.attributes;
      const app = a.application_metadata?.name ?? a.protocol ?? "Carteira";
      if (/lighter/i.test(app)) continue; // vem da API da Lighter, com mais detalhe
      const symbol = a.fungible_info?.symbol ?? a.name;
      const value = a.value ?? 0;
      if (value < 0.01 && a.position_type !== "loan") continue;
      items.push({
        app,
        chain: p.relationships?.chain?.data?.id ?? "",
        type: a.position_type,
        symbol,
        name: a.fungible_info?.name ?? a.name,
        qty: a.quantity.float,
        // emprestimo tomado entra negativo no patrimonio
        value: a.position_type === "loan" ? -value : value,
        cls: assetClass(symbol),
        maturity: maturityOf(`${a.name} ${symbol}`),
        fungibleId: p.relationships?.fungible?.data?.id,
        owner: address,
      });
    }
    url = body.links?.next ?? null;
  }
  return items;
}

type LighterAccount = {
  collateral: string;
  available_balance: string;
  positions: { symbol: string; sign: number; position: string; avg_entry_price: string; position_value: string; unrealized_pnl: string; initial_margin_fraction: string; liquidation_price: string }[];
};

async function lighter(address: string): Promise<WalletDoc["lighter"]> {
  const res = await fetch(`${LIGHTER}/account?by=l1_address&value=${address}`, { cache: "no-store" });
  if (!res.ok) return null; // conta inexistente: a Lighter so registra depois do primeiro deposito
  const body = (await res.json()) as { accounts?: LighterAccount[] };
  const acc = body.accounts?.[0];
  if (!acc) return null;
  const perps: WalletPerp[] = acc.positions
    .filter((p) => Number(p.position) !== 0)
    .map((p) => ({
      symbol: p.symbol,
      side: p.sign >= 0 ? "long" : "short",
      size: Number(p.position),
      entry: Number(p.avg_entry_price),
      notional: Math.abs(Number(p.position_value)),
      pnl: Number(p.unrealized_pnl),
      maxLev: 100 / Number(p.initial_margin_fraction),
      liq: Number(p.liquidation_price) || null,
    }));
  const value = Number(acc.collateral) + perps.reduce((s, p) => s + p.pnl, 0);
  return { value, available: Number(acc.available_balance), perps };
}

// Le todos os enderecos (EVM: Zerion + Lighter; Solana: RPC + Jupiter). A falha de uma fonte vira aviso.
export async function readWallet(addresses: string[]): Promise<WalletDoc> {
  const evm = addresses.filter(isEvmAddress);
  const sol = addresses.filter(isSolAddress);
  const tag = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const jobs = [
    ...evm.map((a) => zerion(a).catch((e) => Promise.reject(new Error(`${tag(a)}: ${e.message}`)))),
    ...sol.map((a) => readSolana(a).catch((e) => Promise.reject(new Error(`${tag(a)}: ${e.message}`)))),
  ];
  const [res, lts] = await Promise.all([Promise.allSettled(jobs), Promise.allSettled(evm.map(lighter))]);
  const items = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const accounts = lts.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  const lt = accounts.length
    ? { value: accounts.reduce((s, a) => s + a.value, 0), available: accounts.reduce((s, a) => s + a.available, 0), perps: accounts.flatMap((a) => a.perps) }
    : null;
  const errors = [...res, ...lts].filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason));
  return {
    address: walletKey(addresses), addresses, at: Date.now(),
    total: items.reduce((s, i) => s + i.value, 0) + (lt?.value ?? 0), items, lighter: lt, errors,
  };
}

// Le a carteira e grava wallet/main. Sem chave da Zerion ainda grava a parte da Lighter (com o aviso).
// base = espaco de quem atualiza ("" = dono, "users/{uid}/" = membro)
export async function refreshWallet({ force, base = "" }: { force: boolean; base?: string }) {
  const db = adminDb();
  const addresses = walletAddresses((await db.doc(`${base}config/main`).get()).data() ?? {});
  if (!addresses.length) return { skipped: true, reason: "sem endereco de carteira na Configuracao" };
  const ref = db.doc(`${base}wallet/main`);
  const prev = (await ref.get()).data() as WalletDoc | undefined;
  if (!force && prev?.address === walletKey(addresses) && Date.now() - prev.at < AUTO_INTERVAL_MS) return { skipped: true, reason: "atualizada ha menos de 30 min" };
  const doc = await readWallet(addresses);
  // Lucro/prejuizo por token: a cada 6 h ou no botao; senao mantem o ultimo calculado
  const now = Date.now();
  const tried = prev?.pnlTriedAt ?? 0;
  const pnlDue = prev?.pnlThrottled
    ? now - tried > PNL_THROTTLE_MS
    : force ? now - tried > PNL_MIN_GAP_MS : !prev?.pnlAt || now - prev.pnlAt > PNL_INTERVAL_MS;
  // Sempre parte do ultimo valor conhecido; uma consulta nova so acrescenta ou substitui
  [doc.pnl, doc.pnlAt, doc.pnlErrors, doc.pnlTriedAt, doc.pnlThrottled] =
    [prev?.pnl, prev?.pnlAt, prev?.pnlErrors ?? [], prev?.pnlTriedAt, prev?.pnlThrottled];
  if (pnlDue) {
    // Falha no preco medio nao conta como falha da leitura (nao impede o retrato do dia): vai em pnlErrors
    doc.pnlTriedAt = now;
    try {
      const r = await zerionPnl(doc.items);
      doc.pnlErrors = r.errors;
      doc.pnlThrottled = r.throttled;
      if (Object.keys(r.pnl).length) [doc.pnl, doc.pnlAt] = [{ ...(r.errors.length ? prev?.pnl ?? {} : {}), ...r.pnl }, now];
    } catch (e) {
      doc.pnlErrors = [String(e)];
    }
  }
  await ref.set(JSON.parse(JSON.stringify(doc)));
  // Um retrato por dia (o ultimo do dia vale) para o grafico de evolucao; so com a leitura completa
  if (!doc.errors.length) {
    // dia no horario de Brasilia (antes era UTC: depois das 21:00 o retrato caia no dia seguinte)
    const day = new Date(doc.at - 3 * 3_600_000).toISOString().slice(0, 10);
    await db.doc(`${base}wallet_history/${day}`).set({ t: doc.at, total: doc.total, byClass: walletTotals(doc).byClass, addr: doc.address });
  }
  return { skipped: false, total: doc.total, errors: doc.errors };
}
