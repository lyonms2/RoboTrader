import type { AppConfig } from "./types";

export const isEvmAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
export const isSolAddress = (a: unknown): a is string => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

// Enderecos cadastrados (EVM 0x... e Solana), aceitando o campo antigo "wallet" de um endereco so
export function walletAddresses(cfg: Pick<AppConfig, "wallet" | "wallets">): string[] {
  const list = cfg.wallets?.length ? cfg.wallets : cfg.wallet ? [cfg.wallet] : [];
  return [...new Set(list.map((a) => a.trim()).filter((a) => isEvmAddress(a) || isSolAddress(a)))];
}
// Chave para saber se o retrato da carteira e destes enderecos
export const walletKey = (list: string[]) => list.map((a) => (isEvmAddress(a) ? a.toLowerCase() : a)).sort().join(",");
