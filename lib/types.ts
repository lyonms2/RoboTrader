import type { BarState, Change, Decision, SignalEvent } from "./strategy";

// Documento config/main
export type AppConfig = {
  capitalUsdt: number;
  weights: Record<string, number>;
  positions: Record<string, number>;
  avgPrice: Record<string, number>; // preco medio da posicao aberta (calculado ao registrar operacoes)
  realized: Record<string, number>; // lucro/prejuizo ja realizado em vendas, em USDT (sem taxas)
  reentry: boolean;
  wallet?: string; // endereco publico 0x... da carteira on-chain (opcional, so leitura)
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
  events?: SignalEvent[]; // historico de sinais com motivo (gravado a partir desta versao)
  // expo = exposicao alvo de cada dia (usada para comparar o real com a estrategia)
  chart: { t: number[]; close: number[]; sma: (number | null)[]; hma: (number | null)[]; on: boolean[]; expo?: number[] };
  // Candle de hoje (ainda aberto) como se fechasse agora: so um alerta, o sinal vale no fechamento
  preview?: { state: BarState; decision: Decision } | null;
  updatedAt: number;
};

// Documento trades/{id}: operacao registrada manualmente
export type TradeDoc = { symbol: string; side: "compra" | "venda"; qty: number; price: number; t: number };

// Documento wallet/main: retrato da carteira on-chain (Zerion + Lighter), gravado pelo servidor
export type WalletItem = {
  app: string; // protocolo (Aave V3, Fluid...) ou "Carteira"
  chain: string;
  type: string; // wallet, deposit, staked, locked, reward, loan...
  symbol: string;
  name: string;
  qty: number;
  value: number; // USD (emprestimo tomado entra negativo)
  cls: "stable" | "BTC" | "ETH" | "SOL" | "outro";
  maturity: number | null; // vencimento (ex.: PT do Pendle)
};
export type WalletPerp = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entry: number;
  notional: number;
  pnl: number;
  maxLev: number;
  liq: number | null;
};
export type WalletDoc = {
  address: string;
  at: number;
  total: number;
  items: WalletItem[];
  lighter: { value: number; available: number; perps: WalletPerp[] } | null;
  errors: string[];
};
