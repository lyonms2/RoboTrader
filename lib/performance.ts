import { applyTrade, type Book } from "./ledger";
import type { AppConfig, LatestDoc, TradeDoc } from "./types";

const DAY_MS = 86_400_000;

export type PerfPoint = { t: number; real: number; strat: number };

// Lucro/prejuizo acumulado (USDT) desde a primeira operacao registrada:
//   real  = realizado + posicao aberta a preco de fechamento, refeito dia a dia a partir das operacoes
//   strat = seguindo a estrategia a risca com o capital configurado de cada moeda (exposicao alvo do fechamento
//           anterior aplicada ao retorno do dia; sem taxas, funding e rebalanceio, como o lucro real)
// Ultimo ponto usa o preco ao vivo. Devolve null sem operacoes ou sem a serie de exposicao (antes do 1o recalculo).
export function performance(cfg: AppConfig, latest: LatestDoc[], trades: TradeDoc[], live: Record<string, number>) {
  if (!trades.length) return null;
  const symbols = latest.filter((l) => l.chart.expo?.length).map((l) => l.symbol);
  if (!symbols.length) return null;
  const ref = latest.find((l) => l.symbol === symbols[0])!.chart.t;
  const start = Math.min(...trades.map((t) => t.t));
  // Primeiro candle que contem a primeira operacao (precisa do fechamento anterior como base da estrategia)
  const first = ref.findIndex((t) => t + DAY_MS > start);
  if (first < 0) return null;
  const s0 = Math.max(1, first);

  const sorted = [...trades].sort((a, b) => a.t - b.t);
  const points: PerfPoint[] = [{ t: ref[s0], real: 0, strat: 0 }];
  const books: Record<string, Book> = {};
  const eq: Record<string, number> = {};
  let next = 0;
  const realAt = (px: (s: string) => number | undefined) =>
    Object.entries(books).reduce((sum, [s, b]) => {
      const p = px(s);
      return sum + b.realized + (b.pos > 0 && p ? b.pos * (p - b.avg) : 0);
    }, 0);
  const series = Object.fromEntries(latest.map((l) => [l.symbol, l.chart]));
  const idx = Object.fromEntries(symbols.map((s) => [s, new Map(series[s].t.map((t, i) => [t, i]))]));

  for (let i = s0; i < ref.length; i++) {
    const close = ref[i] + DAY_MS;
    while (next < sorted.length && sorted[next].t < close) {
      const tr = sorted[next++];
      books[tr.symbol] = applyTrade(books[tr.symbol] ?? { pos: 0, avg: 0, realized: 0 }, tr.side, tr.qty, tr.price);
    }
    let strat = 0;
    for (const s of symbols) {
      const c = series[s];
      const j = idx[s].get(ref[i]);
      const cap = cfg.capitalUsdt * (cfg.weights[s] ?? 0);
      eq[s] ??= cap;
      if (j !== undefined && j > 0) eq[s] *= 1 + (c.expo![j - 1] ?? 0) * (c.close[j] / c.close[j - 1] - 1);
      strat += eq[s] - cap;
    }
    const real = realAt((s) => {
      const j = idx[s]?.get(ref[i]);
      return j !== undefined ? series[s].close[j] : undefined;
    });
    points.push({ t: close, real, strat });
  }

  // Agora: operacoes que faltam e preco ao vivo (ou o ultimo fechamento)
  while (next < sorted.length) {
    const tr = sorted[next++];
    books[tr.symbol] = applyTrade(books[tr.symbol] ?? { pos: 0, avg: 0, realized: 0 }, tr.side, tr.qty, tr.price);
  }
  const lastClose = (s: string) => series[s]?.close[series[s].close.length - 1];
  const nowPx = (s: string) => live[s] ?? lastClose(s);
  let strat = 0;
  for (const s of symbols) {
    const c = series[s];
    const cap = cfg.capitalUsdt * (cfg.weights[s] ?? 0);
    const e = eq[s] ?? cap;
    const lc = lastClose(s)!;
    strat += e * (1 + (c.expo![c.expo!.length - 1] ?? 0) * ((nowPx(s) ?? lc) / lc - 1)) - cap;
  }
  points.push({ t: Date.now(), real: realAt(nowPx), strat });
  const capital = symbols.reduce((sum, s) => sum + cfg.capitalUsdt * (cfg.weights[s] ?? 0), 0);
  return { points, start: ref[s0], capital, clipped: ref[0] + DAY_MS > start };
}
