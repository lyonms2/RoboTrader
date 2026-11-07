import type { BarState, Kline } from "./strategy";

const DAY_MS = 86_400_000;
const FEE = 0.001; // a vista, sobre a mudanca de exposicao

export type TradeResult = { entry: number; exit: number | null; ret: number; days: number };
export type RobotStats = {
  since: number; // primeiro dia com sinal valido
  years: number;
  totalRet: number; cagr: number; mdd: number; curDD: number; daysUnderwater: number;
  bhRet: number; bhMdd: number; // comprar e segurar no mesmo periodo
  last12: { strat: number; bh: number } | null;
  trades: TradeResult[]; // mais recentes primeiro (o primeiro pode estar aberto)
  count: number; win: number; avgWin: number; avgLoss: number; streakNow: number; streakMax: number;
};

// Resultado da estrategia nos candles fechados, com a mesma conta do backtest (referencias_robo_lab.py):
// exposicao do fechamento anterior x retorno do dia, 0,1% de taxa sobre a mudanca de exposicao, sem funding.
export function robotStats(k: Kline[], states: BarState[]): RobotStats | null {
  const first = states.findIndex((s) => s.ready);
  if (first < 0 || k.length - first < 60) return null;
  let eq = 1;
  let prev = 0;
  let peak = 1;
  let mdd = 0;
  let uw = 0;
  let longest = 0;
  let entry: { eq: number; t: number; i: number } | null = null;
  const curve: number[] = [1];
  const trades: TradeResult[] = [];
  for (let i = first + 1; i < k.length; i++) {
    const e = states[i - 1].ready ? states[i - 1].expo : 0;
    eq *= 1 + e * (k[i][4] / k[i - 1][4] - 1);
    eq *= 1 - Math.abs(e - prev) * FEE;
    if (prev === 0 && e > 0) entry = { eq, t: k[i - 1][0], i };
    if (prev > 0 && e === 0 && entry) {
      trades.push({ entry: entry.t, exit: k[i - 1][0], ret: eq / entry.eq - 1, days: i - entry.i });
      entry = null;
    }
    prev = e;
    curve.push(eq);
    if (eq >= peak) [peak, uw] = [eq, 0];
    else uw++;
    longest = Math.max(longest, uw);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  if (entry) trades.push({ entry: entry.t, exit: null, ret: eq / entry.eq - 1, days: k.length - entry.i });
  let bhPeak = k[first][4];
  let bhMdd = 0;
  for (let i = first; i < k.length; i++) {
    bhPeak = Math.max(bhPeak, k[i][4]);
    bhMdd = Math.min(bhMdd, k[i][4] / bhPeak - 1);
  }
  const closed = trades.filter((t) => t.exit !== null);
  const wins = closed.filter((t) => t.ret > 0);
  const losses = closed.filter((t) => t.ret <= 0);
  let streak = 0;
  let streakMax = 0;
  for (const t of closed) {
    streak = t.ret <= 0 ? streak + 1 : 0;
    streakMax = Math.max(streakMax, streak);
  }
  const years = (k[k.length - 1][0] - k[first][0]) / DAY_MS / 365.25;
  const n = curve.length;
  const j = k.length - 365;
  return {
    since: k[first][0], years,
    totalRet: eq - 1, cagr: eq ** (1 / years) - 1, mdd, curDD: eq / peak - 1, daysUnderwater: uw,
    bhRet: k[k.length - 1][4] / k[first][4] - 1, bhMdd,
    last12: n > 366 ? { strat: curve[n - 1] / curve[n - 366] - 1, bh: k[k.length - 1][4] / k[j][4] - 1 } : null,
    trades: [...trades].reverse().slice(0, 12),
    count: closed.length, win: closed.length ? wins.length / closed.length : 0,
    avgWin: wins.length ? wins.reduce((s, t) => s + t.ret, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((s, t) => s + t.ret, 0) / losses.length : 0,
    streakNow: streak, streakMax,
  };
}

// Referencia do backtest ate 07/2024 (Binance desde 2017; SOL desde 2020), referencias_robo_lab.py. O periodo depois
// de 07/2024 fica de fora porque e o que o painel mostra "ao vivo": a referencia nao pode conter o que ela julga.
export type Reference = { mdd: number; win: number; avgLoss: number; streak: number; underwater: number; cagr: number };
const REF: Record<string, { off: Reference; on: Reference }> = {
  BTCUSDT: { off: { mdd: -0.34, win: 0.56, avgLoss: -0.065, streak: 2, underwater: 497, cagr: 0.55 },
    on: { mdd: -0.39, win: 0.40, avgLoss: -0.043, streak: 4, underwater: 497, cagr: 0.57 } },
  ETHUSDT: { off: { mdd: -0.41, win: 0.48, avgLoss: -0.068, streak: 3, underwater: 839, cagr: 0.42 },
    on: { mdd: -0.47, win: 0.35, avgLoss: -0.051, streak: 4, underwater: 840, cagr: 0.37 } },
  SOLUSDT: { off: { mdd: -0.55, win: 0.45, avgLoss: -0.084, streak: 3, underwater: 733, cagr: 1.29 },
    on: { mdd: -0.59, win: 0.26, avgLoss: -0.036, streak: 7, underwater: 733, cagr: 1.31 } },
};
export const referenceOf = (symbol: string, reentry: boolean) => REF[symbol]?.[reentry ? "on" : "off"] ?? null;

// Saude: a estrategia ainda se comporta como no backtest? Compara a situacao atual com os piores momentos testados.
export function health(s: RobotStats, ref: Reference | null) {
  if (!ref) return { level: "ok" as const, label: "Sem referencia", reasons: [] as string[] };
  const bad: string[] = [];
  const warn: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (s.curDD < ref.mdd * 1.25) bad.push(`queda atual de ${pct(s.curDD)}, pior que a pior do backtest (${pct(ref.mdd)}) com folga`);
  else if (s.curDD < ref.mdd) warn.push(`queda atual de ${pct(s.curDD)} passou a pior do backtest (${pct(ref.mdd)})`);
  if (s.streakNow > ref.streak + 1) bad.push(`${s.streakNow} perdas seguidas (backtest: no maximo ${ref.streak})`);
  else if (s.streakNow > ref.streak) warn.push(`${s.streakNow} perdas seguidas (backtest: no maximo ${ref.streak})`);
  // Tempo sem novo pico sozinho e sinal fraco (mercado de lado tambem causa): so "atencao"
  if (s.daysUnderwater > ref.underwater) {
    const ctx = s.last12 ? `; nos ultimos 12 meses o robo fez ${pct(s.last12.strat)} contra ${pct(s.last12.bh)} de so segurar` : "";
    warn.push(`${s.daysUnderwater} dias sem novo pico do patrimonio (backtest: ate ${ref.underwater})${ctx}`);
  }
  if (s.last12 && s.last12.strat < 0 && s.last12.strat < s.last12.bh - 0.3)
    warn.push(`ultimos 12 meses: robo ${pct(s.last12.strat)} contra ${pct(s.last12.bh)} de so segurar`);
  if (bad.length) return { level: "bad" as const, label: "Fora do esperado", reasons: [...bad, ...warn] };
  if (warn.length) return { level: "warn" as const, label: "Atencao", reasons: warn };
  return { level: "ok" as const, label: "Dentro do esperado", reasons: [] };
}
