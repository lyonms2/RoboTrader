import type { BarState, Change, Decision } from "./strategy";

// Documento config/main
export type AppConfig = {
  capitalUsdt: number;
  weights: Record<string, number>;
  positions: Record<string, number>;
  reentry: boolean;
};

export const DEFAULT_CONFIG: AppConfig = {
  capitalUsdt: 1000,
  weights: { BTCUSDT: 0.5, ETHUSDT: 0.5 },
  positions: { BTCUSDT: 0, ETHUSDT: 0 },
  reentry: false,
};

// Documento latest/{symbol}: ultimo candle fechado + serie curta para o grafico
export type LatestDoc = {
  symbol: string;
  state: BarState;
  decision: Decision;
  changes: Change[];
  chart: { t: number[]; close: number[]; sma: (number | null)[]; hma: (number | null)[]; on: boolean[] };
  updatedAt: number;
};

// Documento trades/{id}: operacao registrada manualmente
export type TradeDoc = { symbol: string; side: "compra" | "venda"; qty: number; price: number; t: number };
