import { adminDb } from "./firebaseAdmin";
import type { WalletDoc, WalletItem, WalletPerp } from "./types";
import { walletTotals } from "./walletMath";

// Carteira on-chain (so leitura, pelo endereco publico; nunca usa chave privada):
//   Zerion  = saldos e posicoes DeFi em todas as redes EVM (chave gratuita em ZERION_API_KEY)
//   Lighter = conta de perpetuos, API publica sem chave
const ZERION = "https://api.zerion.io/v1";
const LIGHTER = "https://mainnet.zklighter.elliot.ai/api/v1";
// Atualiza no maximo a cada 30 min pelo agendador (48 chamadas/dia; o plano gratuito da Zerion aguenta folgado)
const AUTO_INTERVAL_MS = 30 * 60_000;

export const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

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
  relationships?: { chain?: { data?: { id?: string } } };
};

async function zerion(address: string): Promise<WalletItem[]> {
  const key = process.env.ZERION_API_KEY;
  if (!key) throw new Error("ZERION_API_KEY nao configurada");
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
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

// Le a carteira nas duas fontes; a falha de uma vira aviso e nao impede a outra
export async function readWallet(address: string): Promise<WalletDoc> {
  const [z, l] = await Promise.allSettled([zerion(address), lighter(address)]);
  const items = z.status === "fulfilled" ? z.value : [];
  const lt = l.status === "fulfilled" ? l.value : null;
  const errors = [z, l].filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason));
  return { address, at: Date.now(), total: items.reduce((s, i) => s + i.value, 0) + (lt?.value ?? 0), items, lighter: lt, errors };
}

// Le a carteira e grava wallet/main. Sem chave da Zerion ainda grava a parte da Lighter (com o aviso).
export async function refreshWallet({ force }: { force: boolean }) {
  const db = adminDb();
  const address = (await db.doc("config/main").get()).data()?.wallet;
  if (!isAddress(address)) return { skipped: true, reason: "sem endereco de carteira na Configuracao" };
  const ref = db.doc("wallet/main");
  const prev = (await ref.get()).data() as WalletDoc | undefined;
  if (!force && prev?.address === address && Date.now() - prev.at < AUTO_INTERVAL_MS) return { skipped: true, reason: "atualizada ha menos de 30 min" };
  const doc = await readWallet(address);
  await ref.set(doc);
  // Um retrato por dia (o ultimo do dia vale) para o grafico de evolucao; so com a leitura completa
  if (!doc.errors.length) {
    const day = new Date(doc.at).toISOString().slice(0, 10);
    await db.doc(`wallet_history/${day}`).set({ t: doc.at, total: doc.total, byClass: walletTotals(doc).byClass });
  }
  return { skipped: false, total: doc.total, errors: doc.errors };
}
