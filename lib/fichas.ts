import { adminDb } from "./firebaseAdmin";
import type { FichaDoc, TokenFicha, WalletDoc } from "./types";

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
    if (fdv && mcap > 0 && fdv / mcap >= 2) alerts.push({ level: "warn", text: `${Math.round((1 - mcap / fdv) * 100)}% da oferta ainda vai entrar no mercado (FDV ${(fdv / mcap).toFixed(1)}x o valor de mercado)` });
    else if (fdv && mcap > 0 && fdv / mcap >= 1.3) alerts.push({ level: "info", text: `FDV ${(fdv / mcap).toFixed(1)}x o valor de mercado: ainda ha tokens a liberar` });
    // Rede (BTC, ETH, SOL...): o valor vem de ser a moeda da rede, nao da receita; nao se compara P/F
    if (chain) { /* sem alerta de receita */ }
    else if (!annual || annual < 1_000_000) alerts.push({ level: "info", text: "sem receita relevante conhecida (preco depende de narrativa)" });
    else if (mcap / annual > 100) alerts.push({ level: "warn", text: `caro pela receita: ${Math.round(mcap / annual)}x a receita anual` });
    if (rev?.prev && rev.prev > 0 && rev.r30 < rev.prev * 0.6) alerts.push({ level: "warn", text: `receita caiu ${Math.round((1 - rev.r30 / rev.prev) * 100)}% no ultimo mes` });
    if (m.total_volume !== null && mcap > 0 && m.total_volume / mcap < 0.005) alerts.push({ level: "warn", text: "pouca liquidez (volume diario < 0,5% do valor de mercado)" });
    if ((m.ath_change_percentage ?? 0) < -85) alerts.push({ level: "info", text: `${Math.round(-(m.ath_change_percentage ?? 0))}% abaixo da maxima historica` });
    return {
      id: m.id, symbol: m.symbol.toUpperCase(), name: m.name, image: m.image, price: m.current_price, rank: m.market_cap_rank,
      mcap, fdv, circPct, volume: m.total_volume, change30d: m.price_change_percentage_30d_in_currency ?? null,
      athDrop: m.ath_change_percentage ?? null, revenue30d: rev?.r30 ?? null, revenuePrev30d: rev?.prev ?? null,
      pf: annual && annual > 0 && !chain ? mcap / annual : null, kind: chain ? "rede" : "token", alerts,
    };
  });
  const found = new Set(items.map((i) => i.symbol));
  const missing = symbols.filter((s) => !found.has(s));
  return { at: Date.now(), items: items.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)), missing, errors };
}

// Atualiza fichas/main (agendador: a cada 12 h; botao do painel: na hora)
export async function refreshFichas({ force, strategy }: { force: boolean; strategy: string[] }) {
  const db = adminDb();
  const ref = db.doc("fichas/main");
  const prev = (await ref.get()).data() as FichaDoc | undefined;
  if (!force && prev && Date.now() - prev.at < REFRESH_MS) return { skipped: true };
  const [cfg, wallet] = await Promise.all([db.doc("config/main").get(), db.doc("wallet/main").get()]);
  const symbols = fichaSymbols(strategy, wallet.data() as WalletDoc | undefined, (cfg.data()?.watchlist as string[] | undefined) ?? []);
  const doc = await buildFichas(symbols);
  await ref.set(JSON.parse(JSON.stringify(doc)));
  return { skipped: false, count: doc.items.length, missing: doc.missing, errors: doc.errors };
}
