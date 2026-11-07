import type { BarState, Change, Decision, SignalEvent } from "./strategy";
import type { RobotStats } from "./robotStats";

// Documento config/main
export type AppConfig = {
  capitalUsdt: number;
  weights: Record<string, number>;
  positions: Record<string, number>;
  avgPrice: Record<string, number>; // preco medio da posicao aberta (calculado ao registrar operacoes)
  realized: Record<string, number>; // lucro/prejuizo ja realizado em vendas, em USDT (sem taxas)
  reentry: boolean;
  wallet?: string; // (antigo) um endereco so; agora vale "wallets"
  wallets?: string[]; // enderecos publicos: EVM 0x... (Rabby, Phantom EVM) e Solana (Phantom). So leitura
  watchlist?: string[];
  costBasis?: Record<string, number>; // preco medio digitado por token (quando nao ha dado automatico) // simbolos extras para as fichas (ex.: ["HYPE", "PENDLE"])
  walletPositions?: boolean;
  // Divisao do patrimonio: nucleo = robo (BTC/ETH/SOL); satelite = rompimento 55/20 em outros tokens (ate 5 posicoes)
  alloc?: { core: number; satellite: number };
  capitalFromWallet?: boolean; // capital = patrimonio das carteiras on-chain (no lugar de capitalUsdt) // posicao da estrategia vem das carteiras (saldo a vista de BTC/ETH/SOL)
  // Importacao automatica da Lighter: posicoes sincronizadas e operacoes desde "since" (ms)
  lighter?: { enabled: boolean; since: number };
  // Financas fora da cripto (cofrinho, Tesouro, acoes/FIIs, outros), em reais. Lancadas a mao; precos automaticos
  finance?: FinItem[];
  monthlyCost?: number; // gasto mensal em R$ (para dizer quantos meses a reserva cobre)
};

// Investimento fora da cripto. Valores em R$
export type FinKind = "caixa" | "tesouro" | "acao" | "outro";
export type FinItem = {
  id: string;
  kind: FinKind;
  name: string; // ex.: "Cofrinho Nubank", "TAEE11"
  reserva?: boolean; // faz parte da reserva de emergencia
  // caixa (cofrinho, CDB com liquidez diaria): saldo informado numa data + % do CDI -> rendimento estimado ate hoje
  balance?: number; balanceAt?: number; cdiPct?: number;
  title?: string; // tesouro: "Tesouro Selic|01/03/2029" (tipo|vencimento)
  ticker?: string; // acao/FII/ETF na B3, sem ".SA"
  qty?: number; avg?: number; // tesouro e acao: quantidade e preco medio por unidade (R$)
  value?: number; valueAt?: number; // outro: valor informado a mao
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
  stats?: RobotStats | null; // resultados da estrategia nos candles disponiveis (~2,7 anos)
  // expo = exposicao alvo de cada dia (usada para comparar o real com a estrategia)
  chart: { t: number[]; close: number[]; sma: (number | null)[]; hma: (number | null)[]; on: boolean[]; expo?: number[] };
  // Candle de hoje (ainda aberto) como se fechasse agora: so um alerta, o sinal vale no fechamento
  preview?: { state: BarState; decision: Decision } | null;
  updatedAt: number;
};

// Documento trades/{id}: operacao registrada manualmente
export type TradeDoc = {
  symbol: string;
  side: "compra" | "venda";
  qty: number;
  price: number;
  t: number;
  source?: "lighter"; // importada automaticamente (so leitura); sem source = lancada a mao
  ext?: string; // id da ordem na Lighter
  note?: string;
};

// Documento sync/lighter: posicoes da conta na Lighter (somadas as manuais no painel)
export type LighterSyncDoc = {
  at: number;
  account: number;
  since: number;
  positions: Record<string, number>;
  avgPrice: Record<string, number>;
  realized: Record<string, number>;
  shorts: string[]; // posicoes vendidas (a estrategia e so comprada; ficam fora da conta)
  lastFill: number;
};

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
  fungibleId?: string; // id do token na Zerion (para o lucro/prejuizo)
  owner?: string; // endereco da carteira que tem o token
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
  address: string; // chave dos enderecos lidos (walletKey)
  addresses?: string[];
  at: number;
  total: number;
  items: WalletItem[];
  lighter: { value: number; available: number; perps: WalletPerp[] } | null;
  errors: string[];
  // Lucro/prejuizo por token (Zerion, FIFO), por id do token, somado entre as carteiras
  pnl?: Record<string, { netInvested: number; unrealized: number; realized: number; avgBuy?: number }>;
  pnlAt?: number;
  pnlErrors?: string[]; // por que o preco medio automatico falhou (por carteira)
  pnlTriedAt?: number; // ultima tentativa (para nao gastar a cota com cliques seguidos)
  pnlThrottled?: boolean; // a ultima tentativa bateu no limite da Zerion (429): espera 3 h
};

// Documento wallet_history/{AAAA-MM-DD}: ultimo retrato do dia, para o grafico de evolucao
export type WalletHistoryDoc = { t: number; total: number; byClass: Record<WalletItem["cls"], number> };

// Documento fichas/main: ficha de cada token (oferta, avaliacao, receita), gerada pelo servidor
export type TokenFicha = {
  id: string; // id da CoinGecko
  symbol: string;
  name: string;
  image: string;
  price: number;
  rank: number | null;
  mcap: number;
  fdv: number | null;
  circPct: number | null; // oferta circulante / maxima (ou total)
  volume: number | null;
  change30d: number | null;
  athDrop: number | null; // % abaixo da maxima historica (negativo)
  revenue30d: number | null; // USD, DefiLlama
  revenuePrev30d: number | null;
  pf: number | null; // valor de mercado / receita anualizada (so para tokens de protocolo)
  kind: "rede" | "token"; // rede: receita = taxas pagas na rede
  // use: entrada = filtro antes de comprar; saida = reduzir se exposto; olho = so acompanhar
  alerts: { level: "warn" | "info"; text: string; use?: ("entrada" | "saida" | "olho")[] }[];
  situacao: Situacao | null;
  held: number; // USD que voce tem do token nas carteiras
  target: number | null; // USD alvo no satelite (rompimento); null = sem alvo
  action: string | null; // ex.: "comprar ~$40", "vender tudo (~$35)"
};
// Situacao do token: sinal de preco (robo ou rompimento 55/20) combinado com os alertas da ficha
export type Situacao = {
  code: "entrada" | "entrada_metade" | "sem_vaga" | "manter" | "tendencia" | "saida" | "reduzir" | "observar" | "fora" | "fora_sistema" | "sem_dados";
  label: string;
  detail: string;
};
export type FichaDoc = { at: number; items: TokenFicha[]; missing: string[]; errors: string[] };

// Documento finance/main: dados publicos para as financas (gravado pelo servidor)
export type FinQuote = {
  name: string; price: number; change: number; type: "acao" | "fii" | "etf"; at: number;
  divs: { t: number; v: number }[]; // proventos por cota (data ex), ultimos 2 anos
};
export type TesouroTitle = { name: string; venc: string; pu: number; taxa: number };
export type FinanceDoc = {
  at: number;
  usdbrl: number | null; // dolar (PTAX venda do BC)
  cdi: { d: string[]; v: number[] }; // CDI diario (% ao dia), datas AAAA-MM-DD
  ipca12m: number | null; ipcaRef: string | null;
  tesouro: { date: string; at: number; titles: TesouroTitle[] } | null;
  quotes: Record<string, FinQuote>;
  errors: string[];
};
