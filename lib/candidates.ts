import { adminDb } from "./firebaseAdmin";
import { fetchDaily } from "./market";
import { robotStats } from "./robotStats";
import { DEFAULT_PARAMS, runStrategy } from "./strategy";
import { SYMBOLS } from "./types";

// "Outras moedas para o robo": roda a MESMA regra do robo (SMA 150 + HMA 100 + alvo de vol) em varias moedas da Binance
// (so como fonte de precos) e compara com as moedas atuais. Atualiza 1 vez por semana (o resultado muda devagar).
const UNIVERSE = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "TRX", "LINK", "AVAX", "SUI", "LTC", "BCH", "DOT", "NEAR", "AAVE",
  "UNI", "XLM", "HBAR", "APT", "ARB", "OP", "INJ", "PEPE", "ATOM", "FIL", "ETC", "ICP", "SHIB", "RENDER",
];
const REFRESH_MS = 7 * 86_400_000;

export type CandidateRow = {
  coin: string;
  inRobot: boolean;
  years: number;
  totalRet: number; bhRet: number; cagr: number; mdd: number; bhMdd: number;
  score: number; // retorno ao ano / |pior queda|
  halves: { strat: [number, number]; bh: [number, number] };
  last12: { strat: number; bh: number } | null;
  verdict: "no_robo" | "candidato" | "neutro" | "nao_serve" | "pouco_historico";
  reason: string;
};
export type CandidatesDoc = { at: number; rows: CandidateRow[]; baseline: number; reentry: boolean };

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;

export async function buildCandidates(extra: string[], reentry: boolean): Promise<CandidatesDoc> {
  const coins = [...new Set([...UNIVERSE, ...extra.map((s) => s.toUpperCase())])];
  const params = { ...DEFAULT_PARAMS, reentry };
  const rows: CandidateRow[] = [];
  // 6 moedas por vez para nao sobrecarregar a API publica da Binance
  for (let i = 0; i < coins.length; i += 6) {
    const batch = await Promise.all(coins.slice(i, i + 6).map(async (coin) => {
      try {
        const { closed } = await fetchDaily(`${coin}USDT`);
        const s = robotStats(closed, runStrategy(closed, params));
        return s?.halves ? { coin, s } : { coin, s: null };
      } catch {
        return null; // nao negocia contra USDT na Binance
      }
    }));
    for (const b of batch) {
      if (!b) continue;
      const inRobot = SYMBOLS.includes(`${b.coin}USDT`);
      if (!b.s || !b.s.halves) {
        rows.push({ coin: b.coin, inRobot, years: 0, totalRet: 0, bhRet: 0, cagr: 0, mdd: 0, bhMdd: 0, score: 0,
          halves: { strat: [0, 0], bh: [0, 0] }, last12: null, verdict: "pouco_historico", reason: "menos de ~1 ano de grafico" });
        continue;
      }
      const s = b.s;
      rows.push({
        coin: b.coin, inRobot, years: s.years, totalRet: s.totalRet, bhRet: s.bhRet, cagr: s.cagr, mdd: s.mdd, bhMdd: s.bhMdd,
        score: s.cagr / Math.max(-s.mdd, 0.05), halves: s.halves!, last12: s.last12, verdict: "neutro", reason: "",
      });
    }
  }
  // Referencia: a pior moeda atual do robo em retorno/risco
  const current = rows.filter((r) => r.inRobot && r.verdict !== "pouco_historico");
  const baseline = current.length ? Math.min(...current.map((r) => r.score)) : 0;
  // Para entrar: no minimo o retorno/risco da pior atual, e nunca abaixo de 0,3
  const bar = Math.max(baseline, 0.3);
  for (const r of rows) {
    if (r.verdict === "pouco_historico") continue;
    const posBoth = r.halves.strat[0] > 0 && r.halves.strat[1] > 0;
    const protects = r.mdd > r.bhMdd * 0.7; // queda do robo no maximo 70% da queda de so segurar
    if (r.inRobot) {
      r.verdict = "no_robo";
      r.reason = r.score < baseline * 1.0001 && current.length > 1 ? "a mais fraca das atuais (referencia)" : "ja esta no robo";
    } else if (r.totalRet <= 0) {
      r.verdict = "nao_serve";
      r.reason = `o robo perdeu dinheiro (${pct(r.totalRet)})`;
    } else if (r.years >= 2 && posBoth && protects && r.score >= bar && r.mdd > -0.55) {
      r.verdict = "candidato";
      r.reason = "lucro nas duas metades, queda bem menor que so segurar e retorno/risco no nivel das atuais";
    } else {
      r.verdict = "neutro";
      r.reason = r.years < 2 ? "historico curto (menos de 2 anos)"
        : !posBoth ? "perdeu dinheiro numa das metades"
        : !protects ? `nao protegeu nas quedas (${pct(r.mdd)} contra ${pct(r.bhMdd)} de so segurar)`
        : r.mdd <= -0.55 ? `queda alta (${pct(r.mdd)})`
        : "retorno/risco abaixo das atuais";
    }
  }
  const order = { no_robo: 0, candidato: 1, neutro: 2, nao_serve: 3, pouco_historico: 4 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || b.score - a.score);
  return { at: Date.now(), rows, baseline, reentry };
}

// Agendador e botao: refaz no maximo 1 vez por semana (ou se a reentrada mudou)
export async function refreshCandidates({ force }: { force: boolean }) {
  const db = adminDb();
  const ref = db.doc("candidates/main");
  const [prev, cfg] = await Promise.all([ref.get(), db.doc("config/main").get()]);
  const p = prev.data() as CandidatesDoc | undefined;
  const reentry = !!cfg.data()?.reentry;
  if (!force && p && p.reentry === reentry && Date.now() - p.at < REFRESH_MS) return { skipped: true };
  const doc = await buildCandidates((cfg.data()?.watchlist as string[] | undefined) ?? [], reentry);
  await ref.set(JSON.parse(JSON.stringify(doc)));
  return { skipped: false, count: doc.rows.length };
}
