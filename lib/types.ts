import type { BarState, Change, Decision } from "./strategy";

// Documento config/main
export type AppConfig = {
  capitalUsdt: number;
  weights: Record<string, number>;
  positions: Record<string, number>;
  avgPrice: Record<string, number>; // preco medio da posicao aberta (calculado ao registrar operacoes)
  realized: Record<string, number>; // lucro/prejuizo ja realizado em vendas, em USDT (sem taxas)
  reentry: boolean;
};

// Ativos acompanhados pelo robo (pares do spot da Binance)
export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export const DEFAULT_CONFIG: AppConfig = {
  capitalUsdt: 1000,
  weights: { BTCUSDT: 0.34, ETHUSDT: 0.33, SOLUSDT: 0.33 },
  positions: { BTCUSDT: 0, ETHUSDT: 0, SOLUSDT: 0 },
  avgPrice: {},
  realized: {},
  reentry: false,
};

// Documento latest/{symbol}: ultimo candle fechado + serie curta para o grafico
export type LatestDoc = {
  symbol: string;
  state: BarState;
  decision: Decision;
  changes: Change[];
  chart: { t: number[]; close: number[]; sma: (number | null)[]; hma: (number | null)[]; on: boolean[] };
  // Candle de hoje (ainda aberto) como se fechasse agora: so um alerta, o sinal vale no fechamento
  preview?: { state: BarState; decision: Decision } | null;
  updatedAt: number;
};

// Documento trades/{id}: operacao registrada manualmente
export type TradeDoc = { symbol: string; side: "compra" | "venda"; qty: number; price: number; t: number };
