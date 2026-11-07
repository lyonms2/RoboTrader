import { adminDb } from "./firebaseAdmin";
import { fetchDaily } from "./market";
import { DEFAULT_PARAMS, runStrategy, type Kline } from "./strategy";
import { allocOf, baseCapital } from "./positions";
import type { AppConfig, FichaDoc, LatestDoc, Situacao, TokenFicha, WalletDoc } from "./types";

type Alert = TokenFicha["alerts"][number];
const DAY_MS = 86_400_000;

// Ficha de cada token (fora do grafico): oferta, avaliacao e receita. Fontes gratuitas e sem chave:
//   CoinGecko (valor de mercado, FDV, oferta, maxima historica) e DefiLlama (receita dos ultimos 30 dias)
// Serve como alerta de risco: no backtest (fundamentos_lab.py) esses dados nao melhoraram o momento de compra.
const CG = "https://api.coingecko.com/api/v3";
const LLAMA = "https://api.llama.fi";
const REFRESH_MS = 12 * 3_600_000; // agendador: 2 vezes por dia
// Redes (L1/L2): a receita e a da propria rede na DefiLlama
const CHAIN_SLUG: Record<string, string> = {
  bitcoin: "bitcoin", ethereum: "ethereum", solana: "solana", binancecoin: "bsc", tron: "tron", "avalanche-2": "avalanche",
  "matic-network": "polygon", "polygon-ecosystem-token": "polygon", sui: "sui", aptos: "aptos", near: "near", arbitrum: "arbitrum",
  optimism: "optimism", "the-open-network": "ton", cardano: "cardano",
};
const STABLE = /^(USDC|USDT|USDT0|USD₮0|DAI|GHO|USDE|FDUSD|PYUSD|USDS|FRAX|LUSD|TUSD|USD1)$/i;

type Market = {
  id: string; symbol: string; name: string; image: string; current_price: number; market_cap: number | null; market_cap_rank: number | null;
  fully_diluted_valuation: number | null; total_volume: number | null; circulating_supply: number | null; total_supply: number | null;
  max_supply: number | null; ath_change_percentage: number | null; price_change_percentage_30d_in_currency?: number | null;
};
type Rev = { total30d: number | null; total60dto30d?: number | null; parentProtocol?: string; id: string; name: string };

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "robotrader/1.0" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} respondeu HTTP ${res.status}`);
  return (await res.json()) as T;
}

// Simbolos a acompanhar: moedas da estrategia + tokens das carteiras (nao estaveis, >= $1) + lista da Configuracao
export function fichaSymbols(strategy: string[], wallet: WalletDoc | undefined, watch: string[] = []) {
  const fromWallet = (wallet?.items ?? []).filter((i) => i.value >= 1 && i.cls !== "stable" && !STABLE.test(i.symbol)).map((i) => i.symbol);
  const norm = (s: string) => s.trim().toUpperCase().replace(/^W(ETH|BTC|SOL)$/, "$1").replace(/^(CB|T)BTC$/, "BTC").replace(/^(ST|WST|WE|R)ETH$/, "ETH");
  return [...new Set([...strategy, ...fromWallet, ...watch].map(norm).filter((s) => /^[A-Z0-9]{2,12}$/.test(s)))].slice(0, 40);
}

export async function buildFichas(symbols: string[]): Promise<FichaDoc> {
  const errors: string[] = [];
  const markets = await json<Market[]>(
    `${CG}/coins/markets?vs_currency=usd&symbols=${symbols.map((s) => s.toLowerCase()).join(",")}&include_tokens=top&price_change_percentage=30d`);
  // Receita: protocolos (agrupados pelo protocolo-pai) e redes
  const revenue = new Map<string, { r30: number; prev: number | null }>();
  try {
    const [overview, protocols] = await Promise.all([
      json<{ protocols: Rev[] }>(`${LLAMA}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue`),
      json<{ id: string; gecko_id: string | null; parentProtocol?: string }[]>(`${LLAMA}/protocols`),
    ]);
    const byParent = new Map<string, { r30: number; prev: number }>();
    for (const p of overview.protocols) {
      const key = p.parentProtocol ?? p.id;
      const cur = byParent.get(key) ?? { r30: 0, prev: 0 };
      cur.r30 += p.total30d ?? 0;
      cur.prev += p.total60dto30d ?? 0;
      byParent.set(key, cur);
    }
    // Um token pode aparecer em varios protocolos: fica o grupo de maior receita
    const put = (gecko: string, r: { r30: number; prev: number } | undefined) => {
      if (r && r.r30 > (revenue.get(gecko)?.r30 ?? -1)) revenue.set(gecko, { r30: r.r30, prev: r.prev || null });
    };
    for (const p of protocols) if (p.gecko_id) put(p.gecko_id, byParent.get(p.parentProtocol ?? p.id));
    // Protocolo-pai sem gecko_id na lista (ex.: Pendle): tenta pelo nome
    for (const m of markets) put(m.id, byParent.get(`parent#${m.name.toLowerCase().replace(/\s+/g, "-")}`) ?? byParent.get(`parent#${m.id}`));
  } catch (e) {
    errors.push(`receita de protocolos: ${String(e)}`);
  }
  // Redes: taxas pagas pelos usuarios da rede (a "receita" da DefiLlama para rede e so a parte queimada)
  for (const m of markets) {
    const slug = CHAIN_SLUG[m.id];
    if (!slug) continue;
    try {
      const r = await json<{ total30d: number | null; total60dto30d: number | null }>(
        `${LLAMA}/summary/fees/${slug}?dataType=dailyFees&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
      revenue.set(m.id, { r30: r.total30d ?? 0, prev: r.total60dto30d ?? null });
    } catch {
      // rede sem dado de receita: fica como "sem receita conhecida"
    }
  }

  const items: TokenFicha[] = markets.map((m) => {
    const rev = revenue.get(m.id);
    const mcap = m.market_cap ?? 0;
    const fdv = m.fully_diluted_valuation ?? null;
    const annual = rev ? rev.r30 * 12 : null;
    const circPct = m.max_supply ? (m.circulating_supply ?? 0) / m.max_supply : m.total_supply ? (m.circulating_supply ?? 0) / m.total_supply : null;
    const chain = m.id in CHAIN_SLUG;
    const alerts: TokenFicha["alerts"] = [];
    // use: entrada = filtro antes de comprar (metade do tamanho ou nao entrar); saida = reduzir se estiver exposto;
    //      olho = so acompanhar. Quem manda entrar e sair e o preco (robo / rompimento), nao estes alertas.
    const add = (level: "warn" | "info", use: Alert["use"], text: string) => alerts.push({ level, use, text });
    if (fdv && mcap > 0 && fdv / mcap >= 2) add("warn", ["entrada"], `${Math.round((1 - mcap / fdv) * 100)}% da oferta ainda vai entrar no mercado (FDV ${(fdv / mcap).toFixed(1)}x o valor de mercado)`);
    else if (fdv && mcap > 0 && fdv / mcap >= 1.3) add("info", ["olho"], `FDV ${(fdv / mcap).toFixed(1)}x o valor de mercado: ainda ha tokens a liberar`);
    // Rede (BTC, ETH, SOL...): o valor vem de ser a moeda da rede, nao da receita; nao se compara P/F
    if (chain) { /* sem alerta de receita */ }
    else if (!annual || annual < 1_000_000) add("info", ["olho"], "sem receita relevante conhecida (preco depende de narrativa): posicao pequena");
    else if (mcap / annual > 100) add("info", ["olho"], `caro pela receita: ${Math.round(mcap / annual)}x a receita anual`);
    if (rev?.prev && rev.prev > 0 && rev.r30 < rev.prev * 0.6) add("warn", ["saida"], `receita caiu ${Math.round((1 - rev.r30 / rev.prev) * 100)}% no ultimo mes`);
    else if (!chain && rev?.prev && rev.prev > 0 && rev.r30 > rev.prev * 1.5) add("info", ["olho"], `receita subiu ${Math.round((rev.r30 / rev.prev - 1) * 100)}% no ultimo mes: espere o rompimento confirmar`);
    if (m.total_volume !== null && mcap > 0 && m.total_volume / mcap < 0.005) add("warn", ["entrada", "saida"], "pouca liquidez (volume diario < 0,5% do valor de mercado)");
    if ((m.ath_change_percentage ?? 0) < -85) add("info", ["olho"], `${Math.round(-(m.ath_change_percentage ?? 0))}% abaixo da maxima historica`);
    return {
      id: m.id, symbol: m.symbol.toUpperCase(), name: m.name, image: m.image, price: m.current_price, rank: m.market_cap_rank,
      mcap, fdv, circPct, volume: m.total_volume, change30d: m.price_change_percentage_30d_in_currency ?? null,
      athDrop: m.ath_change_percentage ?? null, revenue30d: rev?.r30 ?? null, revenuePrev30d: rev?.prev ?? null,
      pf: annual && annual > 0 && !chain ? mcap / annual : null, kind: chain ? "rede" : "token", alerts, situacao: null,
      held: 0, target: null, action: null,
    };
  });
  const found = new Set(items.map((i) => i.symbol));
  const missing = symbols.filter((s) => !found.has(s));
  return { at: Date.now(), items: items.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)), missing, errors };
}

const dayStr = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const ROBO: Record<string, Situacao["code"]> = { COMPRAR: "entrada", REENTRADA: "entrada", VENDER_TUDO: "saida", VENDER_PARTE: "reduzir" };

// Rompimento 55/20 (item 5r do RESUMO) refeito nos candles fechados: entra ao fechar na maxima de 55 dias com o BTC em
// alta; sai ao fechar na minima de 20 dias ou com o BTC saindo da alta. Devolve o estado no ultimo candle fechado.
export function breakoutState(k: Kline[], btcUp: Map<number, boolean>) {
  let inPos = false;
  let since = 0;
  let event: "entrada" | "saida" | null = null;
  for (let i = 56; i < k.length; i++) {
    const [t, , , , c] = k[i];
    const hi = Math.max(...k.slice(i - 55, i).map((r) => r[2]));
    const lo = Math.min(...k.slice(i - 20, i).map((r) => r[3]));
    event = null;
    if (!inPos && btcUp.get(t) && c > hi) [inPos, since, event] = [true, t, "entrada"];
    else if (inPos && (c < lo || !btcUp.get(t))) [inPos, since, event] = [false, t, "saida"];
  }
  return { inPos, since, event, high55: Math.max(...k.slice(-55).map((r) => r[2])), low20: Math.min(...k.slice(-20).map((r) => r[3])) };
}

// Junta o sinal de preco (robo para BTC/ETH/SOL; rompimento 55/20 para os outros) com os alertas da ficha
const SLOTS = 5;
const usd = (v: number) => `$${Math.round(v).toLocaleString("pt-BR")}`;

// Pico de volume no ultimo candle fechado (volume em USDT da Binance contra a media dos 30 dias anteriores).
// So alerta para olhar: no backtest (volume_lab.py) nao melhorou entradas, e picos em dia de alta costumam devolver.
async function volumeAlert(f: TokenFicha) {
  try {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${f.symbol}USDT&interval=1d&limit=33`, { cache: "no-store" });
    if (!res.ok) return;
    const rows = ((await res.json()) as unknown[][]).filter((r) => Number(r[0]) + DAY_MS <= Date.now());
    if (rows.length < 31) return;
    const last = rows[rows.length - 1];
    const avg = rows.slice(-31, -1).reduce((s, r) => s + Number(r[7]), 0) / 30;
    const mult = avg > 0 ? Number(last[7]) / avg : 0;
    if (mult < 3) return;
    const up = Number(last[4]) >= Number(last[1]);
    const move = (Number(last[4]) / Number(last[1]) - 1) * 100;
    f.alerts.push({
      level: mult >= 5 ? "warn" : "info",
      use: ["olho"],
      text: `pico de volume em ${dayStr(Number(last[0]))}: ${mult.toFixed(1)}x a media de 30 dias, dia de ${up ? "alta" : "queda"} (${move > 0 ? "+" : ""}${move.toFixed(1)}%). ` +
        (up ? "Veja se ha noticia; nos testes, a maioria dos picos em dia de alta devolveu o ganho." : "Pode ser capitulacao ou noticia ruim: veja o motivo antes de agir."),
    });
  } catch {
    // sem dado de volume: sem alerta
  }
}

// held = USD de cada token nas carteiras; satCapital = patrimonio x fatia do satelite
async function situacoes(items: TokenFicha[], strategy: string[], latest: LatestDoc[], held: Map<string, number>, reentry: boolean, satCapital: number) {
  const btc = (await fetchDaily("BTCUSDT")).closed;
  const btcUp = new Map(runStrategy(btc, { ...DEFAULT_PARAMS, reentry }).map((s) => [s.t, s.expo > 0]));
  const warn = (f: TokenFicha, use: "entrada" | "saida") => f.alerts.filter((a) => a.level === "warn" && a.use?.includes(use));
  const px = (v: number) => v.toPrecision(5);
  // Vagas do satelite: tokens que voce ja tem e que seguem em tendencia ocupam vaga
  let used = 0;
  const pending: { f: TokenFicha; slot: number; ret: number }[] = [];
  for (const f of items) {
    f.held = held.get(f.symbol) ?? 0;
    const isHeld = f.held >= 1;
    await volumeAlert(f);
    const exitWarn = warn(f, "saida");
    if (strategy.includes(f.symbol)) {
      const l = latest.find((x) => x.symbol === `${f.symbol}USDT`);
      if (!l) {
        f.situacao = { code: "sem_dados", label: "Sem sinal", detail: "clique em Recalcular agora" };
        continue;
      }
      const code = ROBO[l.decision.kind] ?? (l.state.expo > 0 ? (isHeld ? "manter" : "tendencia") : "fora");
      const label = l.decision.kind !== "MANTER" ? l.decision.label
        : code === "fora" ? "Fora (robo)" : code === "manter" ? "Manter (robo)" : "Em tendencia (robo)";
      f.situacao = { code, label, detail: "sinal da estrategia principal (cards acima)" };
      continue;
    }
    let k: Kline[];
    try {
      k = (await fetchDaily(`${f.symbol}USDT`)).closed;
    } catch {
      f.situacao = { code: "sem_dados", label: "Sem grafico", detail: "nao negocia contra USDT na Binance (fonte dos precos)" };
      continue;
    }
    if (k.length < 90) f.alerts.push({ level: "warn", use: ["entrada"], text: `token novo (${k.length} dias de grafico): nos testes, a mediana caiu 13% a 21% nos primeiros 3 meses` });
    if (k.length < 60) {
      f.situacao = { code: "observar", label: "Observar", detail: "historico curto para o rompimento" };
      continue;
    }
    const b = breakoutState(k, btcUp);
    const entryWarn = warn(f, "entrada");
    // Tamanho do backtest: 1/5 do satelite x min(1, 80% / vol 30d); metade com alerta de entrada
    const c = k.map((r) => r[4]).slice(-31);
    const lr = c.slice(1).map((v, i) => Math.log(v / c[i]));
    const mean = lr.reduce((a, v) => a + v, 0) / lr.length;
    const vol = Math.sqrt(lr.reduce((a, v) => a + (v - mean) ** 2, 0) / lr.length) * Math.sqrt(365);
    const slot = (satCapital / SLOTS) * Math.min(1, 0.8 / (vol || 1)) * (entryWarn.length ? 0.5 : 1);
    if (b.event === "entrada" && !isHeld) {
      pending.push({ f, slot, ret: k[k.length - 1][4] / k[k.length - 56][4] - 1 });
      f.situacao = entryWarn.length
        ? { code: "entrada_metade", label: "Entrada com metade", detail: `rompeu a maxima de 55 dias, mas: ${entryWarn.map((a) => a.text).join("; ")}` }
        : { code: "entrada", label: "Entrada", detail: `rompeu a maxima de 55 dias com o BTC em alta (sai ao fechar abaixo de ${px(b.low20)})` };
    } else if (b.event === "saida") {
      f.situacao = { code: "saida", label: isHeld ? "Saida" : "Saiu da tendencia", detail: "fechou na minima de 20 dias ou o BTC saiu da alta" };
      if (isHeld) [f.target, f.action] = [0, `vender tudo (~${usd(f.held)})`];
    } else if (isHeld && exitWarn.length) {
      f.situacao = { code: "reduzir", label: "Reduzir", detail: exitWarn.map((a) => a.text).join("; ") };
      [f.target, f.action] = [b.inPos ? slot / 2 : 0, b.inPos ? `reduzir para ~${usd(slot / 2)}` : `vender (~${usd(f.held)})`];
      if (b.inPos) used++;
    } else if (isHeld && !b.inPos) {
      f.situacao = { code: "fora_sistema", label: "Fora do sistema", detail: "voce tem o token, mas ele nao esta em tendencia pelo rompimento (airdrop, compra antiga...): decisao sua" };
    } else if (b.inPos) {
      const d = Math.round((Date.now() - b.since) / DAY_MS);
      if (isHeld) {
        used++;
        f.target = slot;
        const diff = slot - f.held;
        if (Math.abs(diff) > 0.25 * slot) f.action = diff > 0 ? `rebalancear: comprar ~${usd(diff)}` : `rebalancear: vender ~${usd(-diff)}`;
      }
      f.situacao = isHeld
        ? { code: "manter", label: "Manter", detail: `em tendencia desde ${dayStr(b.since)}; sai ao fechar abaixo de ${px(b.low20)}` }
        : { code: "tendencia", label: "Em tendencia", detail: `entrada foi em ${dayStr(b.since)} (ha ${d} dias): o sinal de compra ja passou` };
    } else {
      const up = btcUp.get(k[k.length - 1][0]);
      f.situacao = { code: "observar", label: "Observar", detail: up ? `compra se fechar acima de ${px(b.high55)}` : "BTC fora da alta: rompimentos nao valem agora" };
    }
  }
  // Entradas novas pela ordem do backtest (maior alta em 55 dias) ate preencher as vagas
  for (const p of pending.sort((a, z) => z.ret - a.ret)) {
    if (satCapital <= 0) {
      p.f.action = "satelite desligado (0% na Configuracao)";
    } else if (used < SLOTS) {
      used++;
      [p.f.target, p.f.action] = [p.slot, `comprar ~${usd(p.slot)}`];
    } else {
      p.f.situacao = { code: "sem_vaga", label: "Sem vaga", detail: `rompeu, mas o satelite ja tem ${SLOTS} posicoes` };
    }
  }
}

// Atualiza fichas/main (agendador: a cada 12 h e depois de cada fechamento diario; botao do painel: na hora)
export async function refreshFichas({ force, strategy }: { force: boolean; strategy: string[] }) {
  const db = adminDb();
  const ref = db.doc("fichas/main");
  const prev = (await ref.get()).data() as FichaDoc | undefined;
  const newCandle = prev && Math.floor(prev.at / DAY_MS) !== Math.floor(Date.now() / DAY_MS);
  if (!force && prev && !newCandle && Date.now() - prev.at < REFRESH_MS) return { skipped: true };
  const [cfg, wallet, latestSnap] = await Promise.all([db.doc("config/main").get(), db.doc("wallet/main").get(), db.collection("latest").get()]);
  const w = wallet.data() as WalletDoc | undefined;
  const symbols = fichaSymbols(strategy, w, (cfg.data()?.watchlist as string[] | undefined) ?? []);
  const doc = await buildFichas(symbols);
  // USD de cada token nas carteiras (mesma normalizacao das fichas: WETH -> ETH etc.)
  const held = new Map<string, number>();
  for (const i of w?.items ?? []) {
    const [sym] = fichaSymbols([], { ...w!, items: [{ ...i, value: Math.max(1, i.value) }] });
    if (sym) held.set(sym, (held.get(sym) ?? 0) + i.value);
  }
  const c = { ...(cfg.data() as AppConfig) };
  const satCapital = c.capitalUsdt !== undefined ? baseCapital(c, w) * allocOf(c).satellite : 0;
  try {
    await situacoes(doc.items, strategy, latestSnap.docs.map((d) => d.data() as LatestDoc), held, !!c.reentry, satCapital);
  } catch (e) {
    doc.errors.push(`situacao: ${String(e)}`);
  }
  await ref.set(JSON.parse(JSON.stringify(doc)));
  return { skipped: false, count: doc.items.length, missing: doc.missing, errors: doc.errors };
}
