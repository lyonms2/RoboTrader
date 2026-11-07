import type { TradeDoc } from "./types";

export type Book = { pos: number; avg: number; realized: number };

const round8 = (v: number) => Math.round(v * 1e8) / 1e8;

// Aplica uma operacao a posicao: compra atualiza o preco medio ponderado; venda realiza o lucro contra o
// preco medio (sem taxas) e nunca deixa a posicao negativa.
export function applyTrade(b: Book, side: TradeDoc["side"], qty: number, price: number): Book {
  if (side === "compra") {
    const pos = b.pos + qty;
    return { pos, avg: b.pos > 0 && b.avg > 0 ? (b.pos * b.avg + qty * price) / pos : price, realized: b.realized };
  }
  const sold = Math.min(qty, b.pos);
  const pos = b.pos - sold;
  return { pos, avg: pos > 1e-12 ? b.avg : 0, realized: b.realized + (b.avg > 0 ? sold * (price - b.avg) : 0) };
}

// Refaz posicao, preco medio e realizado de uma moeda a partir de todas as operacoes dela, em ordem de data
export function rebuild(trades: TradeDoc[], symbol: string): Book {
  const b = trades
    .filter((t) => t.symbol === symbol && t.source !== "lighter")
    .sort((a, z) => a.t - z.t)
    .reduce((acc, t) => applyTrade(acc, t.side, t.qty, t.price), { pos: 0, avg: 0, realized: 0 } as Book);
  return { pos: round8(b.pos), avg: round8(b.avg), realized: round8(b.realized) };
}
