import type { WalletDoc, WalletItem } from "./types";

export type ClassTotals = Record<WalletItem["cls"], number>;

// Patrimonio por classe (soma 100%: a margem da Lighter conta como dolar) e exposicao dos perpetuos por moeda
export function walletTotals(w: WalletDoc) {
  const byClass: ClassTotals = { stable: 0, BTC: 0, ETH: 0, SOL: 0, outro: 0 };
  for (const i of w.items) byClass[i.cls] += i.value;
  if (w.lighter) byClass.stable += w.lighter.value;
  const perpExpo: Record<string, number> = {};
  for (const p of w.lighter?.perps ?? []) perpExpo[p.symbol] = (perpExpo[p.symbol] ?? 0) + (p.side === "long" ? 1 : -1) * p.notional;
  return { byClass, perpExpo };
}
