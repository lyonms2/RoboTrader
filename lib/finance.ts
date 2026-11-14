import { adminDb } from "./firebaseAdmin";
import type { AppConfig, FinanceDoc, FinQuote, TesouroTitle } from "./types";

// Dados publicos e gratuitos para as financas fora da cripto (so leitura, nada de login em banco ou corretora):
// - Acoes, FIIs e ETFs da B3: cotacao e proventos pelo Yahoo Finance
// - CDI, dolar (PTAX) e IPCA: API de series do Banco Central (SGS)
// - Tesouro Direto: precos e taxas do dia pelo Tesouro Transparente (CSV de ~15 MB, baixado no maximo a cada 6 h)
const UA = { "User-Agent": "Mozilla/5.0 (compatible; RoboTrader/1.0)" };
const YAHOO = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const BCB = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const TESOURO_CSV =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";
const REFRESH_MS = 6 * 3_600_000;
const TESOURO_MS = 6 * 3_600_000;

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const br2iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`; // dd/mm/aaaa -> aaaa-mm-dd
const iso2br = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

async function getJson(url: string) {
  const r = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Cotacao + proventos (5 anos) de um papel da B3
export async function quote(ticker: string): Promise<FinQuote> {
  let last = "";
  for (const base of YAHOO) {
    let r: Response;
    try {
      r = await fetch(`${base}/v8/finance/chart/${encodeURIComponent(ticker)}.SA?range=5y&interval=1mo&events=div`,
        { headers: UA, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      last = String(e);
      continue;
    }
    if (r.status === 404) throw new Error(`${ticker}: codigo nao encontrado na B3`);
    if (!r.ok) {
      last = `HTTP ${r.status}`;
      continue;
    }
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const m = res?.meta;
    if (!m?.regularMarketPrice) throw new Error(`${ticker}: sem cotacao`);
    const name: string = m.longName ?? m.shortName ?? ticker;
    const type: FinQuote["type"] = m.instrumentType === "ETF" || /indice|índice|ishares|\betf\b/i.test(name) ? "etf"
      : /imobili|\bfii\b/i.test(name) ? "fii" : "acao";
    const prev = m.chartPreviousClose ?? m.previousClose;
    const change = typeof m.regularMarketChangePercent === "number" ? m.regularMarketChangePercent / 100
      : prev ? m.regularMarketPrice / prev - 1 : 0;
    const divs = Object.values((res?.events?.dividends ?? {}) as Record<string, { amount: number; date: number }>)
      .map((d) => ({ t: d.date * 1000, v: d.amount })).sort((a, b) => a.t - b.t);
    return { name, price: m.regularMarketPrice, change, type, at: (m.regularMarketTime ?? Date.now() / 1000) * 1000, divs };
  }
  throw new Error(`${ticker}: Yahoo indisponivel (${last})`);
}

async function bcb(code: number, query: string) {
  return (await getJson(`${BCB}.${code}/dados${query}${query.includes("?") ? "&" : "?"}formato=json`)) as { data: string; valor: string }[];
}

// Dolar PTAX (venda): a serie 1 do SGS as vezes responde 304 sem dados; nesse caso usa o servico PTAX (Olinda), tambem do Banco Central
export async function usdPtax() {
  try {
    const v = Number((await bcb(1, "/ultimos/1"))[0].valor);
    if (v > 0) return v;
    throw new Error("sem valor");
  } catch (first) {
    const mdy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
    const to = new Date(), from = new Date(to.getTime() - 10 * 86_400_000);
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@a,dataFinalCotacao=@b)?@a='${mdy(from)}'&@b='${mdy(to)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;
    const r = (await getJson(url)) as { value: { cotacaoVenda: number }[] };
    const v = Number(r.value[0]?.cotacaoVenda);
    if (!(v > 0)) throw first;
    return v;
  }
}

// CDI diario dos ultimos ~5 anos (rendimento do cofrinho desde a data do saldo e comparacao dos investimentos com o CDI)
async function cdiSeries() {
  const to = new Date();
  const from = new Date(to.getTime() - 1826 * 86_400_000);
  const rows = await bcb(12, `?dataInicial=${iso2br(from)}&dataFinal=${iso2br(to)}`);
  return { d: rows.map((r) => br2iso(r.data)), v: rows.map((r) => Number(r.valor)) };
}

// Precos do Tesouro no ultimo dia disponivel (PU de venda = quanto voce recebe vendendo hoje, antes de IR)
export async function tesouroToday() {
  const r = await fetch(TESOURO_CSV, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`Tesouro: HTTP ${r.status}`);
  const lines = (await r.text()).split(/\r?\n/);
  let best = "";
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(";");
    if (c.length < 8) continue;
    const d = br2iso(c[2]);
    if (d > best) { best = d; rows.length = 0; }
    if (d === best) rows.push(c);
  }
  if (!rows.length) throw new Error("Tesouro: arquivo sem dados");
  const titles: TesouroTitle[] = rows.map((c) => ({ name: c[0], venc: c[1], pu: num(c[6]), taxa: num(c[3]) }))
    .sort((a, b) => a.name.localeCompare(b.name) || br2iso(a.venc).localeCompare(br2iso(b.venc)));
  return { date: best, at: Date.now(), titles };
}

// Atualiza finance/main. force = botao (refaz cotacoes e indices); o Tesouro so e baixado de novo depois de 6 h
export async function refreshFinance({ force, base = "" }: { force: boolean; base?: string }) {
  const db = adminDb();
  const ref = db.doc(`${base}finance/main`);
  const [prevSnap, cfgSnap] = await Promise.all([ref.get(), db.doc(`${base}config/main`).get()]);
  const prev = prevSnap.data() as FinanceDoc | undefined;
  const items = ((cfgSnap.data() as AppConfig | undefined)?.finance ?? []);
  if (!items.length && !force) return { skipped: true, reason: "nenhum investimento cadastrado" };
  if (!force && prev && Date.now() - prev.at < REFRESH_MS) return { skipped: true };

  const errors: string[] = [];
  const tickers = [...new Set(items.filter((i) => i.kind === "acao" && i.ticker).map((i) => i.ticker!.toUpperCase()))];
  const quotes: Record<string, FinQuote> = {};
  for (let i = 0; i < tickers.length; i += 6) {
    await Promise.all(tickers.slice(i, i + 6).map(async (t) => {
      try {
        quotes[t] = await quote(t);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        if (prev?.quotes?.[t]) quotes[t] = prev.quotes[t]; // mantem a ultima cotacao boa
      }
    }));
  }
  const needTesouro = items.some((i) => i.kind === "tesouro") || !prev?.tesouro;
  const tesouroStale = !prev?.tesouro || Date.now() - prev.tesouro.at > TESOURO_MS;
  // Membro: reaproveita os precos do Tesouro ja baixados pelo dono (o arquivo e grande, ~15 MB) quando estao em dia
  let shared: FinanceDoc["tesouro"] = null;
  if (base && needTesouro && tesouroStale) {
    const root = (await db.doc("finance/main").get()).data() as FinanceDoc | undefined;
    if (root?.tesouro && Date.now() - root.tesouro.at < TESOURO_MS) shared = root.tesouro;
  }
  const [cdi, ptax, ipca, tesouro] = await Promise.all([
    cdiSeries().catch((e) => { errors.push(`CDI (Banco Central): ${String(e)}`); return prev?.cdi ?? { d: [], v: [] }; }),
    usdPtax().catch((e) => { errors.push(`Dolar (Banco Central): ${String(e)}`); return prev?.usdbrl ?? null; }),
    bcb(13522, "/ultimos/1").then((r) => ({ v: Number(r[0].valor) / 100, ref: r[0].data.slice(3) }))
      .catch(() => (prev?.ipca12m != null ? { v: prev.ipca12m, ref: prev.ipcaRef ?? "" } : null)),
    needTesouro && tesouroStale
      ? shared ? Promise.resolve(shared) : tesouroToday().catch((e) => { errors.push(String(e instanceof Error ? e.message : e)); return prev?.tesouro ?? null; })
      : Promise.resolve(prev?.tesouro ?? null),
  ]);
  const doc: FinanceDoc = {
    at: Date.now(), usdbrl: ptax, cdi, ipca12m: ipca?.v ?? null, ipcaRef: ipca?.ref ?? null,
    tesouro, quotes, errors,
  };
  await ref.set(JSON.parse(JSON.stringify(doc)));
  return { skipped: false, tickers: tickers.length, tesouro: tesouro?.date ?? null, errors };
}
