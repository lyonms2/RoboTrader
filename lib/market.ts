import type { Kline } from "./strategy";

const DAY_MS = 86_400_000;

// Candles diarios do spot da Binance (dados publicos, sem chave).
// A Bybit bloqueia IPs dos EUA (onde rodam os servidores da Vercel); os sinais sao identicos nas duas fontes.
// closed = so candles fechados (o sinal oficial); open = candle de hoje ainda em formacao (para a previa).
export async function fetchDaily(symbol: string): Promise<{ closed: Kline[]; open: Kline | null }> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&limit=1000`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance respondeu ${res.status} para ${symbol}`);
  const rows = ((await res.json()) as unknown[][]).map(
    (r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])] as Kline,
  );
  const now = Date.now();
  const closed = rows.filter((r) => r[0] + DAY_MS <= now);
  const last = rows[rows.length - 1];
  return { closed, open: last && last[0] + DAY_MS > now ? last : null };
}
