import type { WalletDoc } from "./types";

export type Row = {
  symbol: string; name: string; qty: number; value: number; price: number; where: string[]; stable: boolean;
  avg: number | null; source: "manual" | "Zerion" | null; cost: number | null; pnl: number | null; pct: number | null;
};

// Junta o mesmo token de varias carteiras, redes e protocolos e calcula preco medio e lucro
export function holdings(wallet: WalletDoc, costBasis: Record<string, number> = {}): Row[] {
  const groups = new Map<string, Row & { ids: Set<string> }>();
  for (const i of wallet.items) {
    if (i.type === "loan" || i.type === "reward") continue;
    const key = i.symbol.toUpperCase();
    const g = groups.get(key) ?? {
      symbol: i.symbol, name: i.name, qty: 0, value: 0, price: 0, where: [], stable: i.cls === "stable",
      avg: null, source: null, cost: null, pnl: null, pct: null, ids: new Set<string>(),
    };
    g.qty += i.qty;
    g.value += i.value;
    const where = i.app === "Carteira" || i.app === "Carteira Solana" ? i.chain : `${i.app}${i.type !== "wallet" ? ` (${i.type})` : ""}`;
    if (where && !g.where.includes(where)) g.where.push(where);
    if (i.fungibleId) g.ids.add(i.fungibleId);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ ids, ...g }) => {
    g.price = g.qty > 0 ? g.value / g.qty : 0;
    const manual = costBasis[g.symbol.toUpperCase()];
    const invested = [...ids].reduce((s, id) => s + (wallet.pnl?.[id]?.netInvested ?? 0), 0);
    const avgBuy = [...ids].map((id) => wallet.pnl?.[id]?.avgBuy ?? 0).find((v) => v > 0) ?? 0;
    if (manual > 0) [g.avg, g.source] = [manual, "manual"];
    // Custo do que ainda esta na carteira (FIFO) / quantidade; sem ele, o preco medio de compra da Zerion
    else if (invested > 0 && g.qty > 0) [g.avg, g.source] = [invested / g.qty, "Zerion"];
    else if (avgBuy > 0) [g.avg, g.source] = [avgBuy, "Zerion"];
    if (g.avg !== null) {
      g.cost = g.avg * g.qty;
      g.pnl = g.value - g.cost;
      g.pct = g.cost > 0 ? (g.pnl / g.cost) * 100 : null;
    }
    return g;
  }).sort((a, b) => b.value - a.value);
}

