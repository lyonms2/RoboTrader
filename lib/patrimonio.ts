import { walletAddresses, walletKey } from "./addresses";
import { dayBR, financeSummary, type FinGroup } from "./financeMath";
import { accountBalance, debts, investFlows, type GastosSetup, type MonthDoc } from "./gastos";
import type { AppConfig, FinanceDoc, WalletDoc } from "./types";

// Patrimonio liquido = bens (cripto + investimentos, em R$) - dividas (emprestimos + faturas a vencer)
export type NetWorthDoc = {
  t: number;
  day: string; // AAAA-MM-DD (Brasilia)
  bens: number;
  dividas: number;
  net: number;
  byGroup: Record<FinGroup, number>;
  partial?: string[]; // o que ficou de fora (ex.: cripto sem dolar)
};

export function netWorth(cfg: AppConfig, fin: FinanceDoc | null, wallet: WalletDoc | null, months: Record<string, MonthDoc>, setup: GastosSetup): NetWorthDoc {
  const okWallet = wallet && wallet.address === walletKey(walletAddresses(cfg)) ? wallet : null;
  const s = financeSummary(cfg.finance ?? [], fin, okWallet, cfg.monthlyCost, accountBalance(months, setup)?.value, investFlows(months));
  const d = debts(months, setup);
  const partial = s.cryptoMissingFx ? ["cripto sem cotacao do dolar"] : [];
  // a receber (o que te devem) conta como bem
  return { t: Date.now(), day: dayBR(Date.now()), bens: s.total + d.recv, dividas: d.total, net: s.total + d.recv - d.total, byGroup: s.byGroup, ...(partial.length ? { partial } : {}) };
}
