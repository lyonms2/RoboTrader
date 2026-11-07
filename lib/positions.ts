import { walletAddresses, walletKey } from "./addresses";
import { holdings } from "./holdings";
import type { AppConfig, LighterSyncDoc, TradeDoc, WalletDoc } from "./types";

const r8 = (v: number) => Math.round(v * 1e8) / 1e8;

export const DEFAULT_ALLOC = { core: 0.75, satellite: 0.25 };
export const allocOf = (cfg: Pick<AppConfig, "alloc">) => cfg.alloc ?? DEFAULT_ALLOC;

// Patrimonio base: total das carteiras (se ligado e lido) ou o capital digitado na Configuracao
export function baseCapital(cfg: AppConfig, wallet?: WalletDoc | null) {
  return cfg.capitalFromWallet && wallet && wallet.address === walletKey(walletAddresses(cfg)) ? wallet.total : cfg.capitalUsdt;
}

// Posicao efetiva usada nos sinais e no painel:
//   - com "posicao das carteiras" ligada: saldo a vista de cada moeda nas carteiras on-chain (valor / preco, entao
//     cbBTC, stETH, JitoSOL etc. contam pelo equivalente em BTC/ETH/SOL), no lugar das posicoes manuais
//   - senao: operacoes lancadas a mao (config)
//   - mais a conta da Lighter, se a importacao estiver ligada
export function effectiveConfig(cfg: AppConfig, sync: LighterSyncDoc | null | undefined, wallet?: WalletDoc | null, px?: Record<string, number>): AppConfig {
  let positions = { ...cfg.positions };
  const avgPrice = { ...(cfg.avgPrice ?? {}) };
  const realized = { ...(cfg.realized ?? {}) };
  if (cfg.walletPositions && wallet && px && wallet.address === walletKey(walletAddresses(cfg))) {
    positions = {};
    const rows = holdings(wallet, cfg.costBasis);
    for (const s of Object.keys(cfg.weights)) {
      const coin = s.replace("USDT", "");
      // Preco medio = o da lista "Meus tokens" (Zerion ou digitado); sem ele, o da Configuracao
      const row = rows.find((r) => r.symbol.toUpperCase() === coin);
      if (row?.avg) avgPrice[s] = row.avg;
      const value = wallet.items.filter((i) => i.cls === coin).reduce((sum, i) => sum + i.value, 0);
      positions[s] = px[s] > 0 ? r8(Math.max(0, value) / px[s]) : 0;
    }
  }
  if (sync && cfg.lighter?.enabled) {
    for (const [s, l] of Object.entries(sync.positions)) {
      const m = positions[s] ?? 0;
      const ma = avgPrice[s] ?? 0;
      const la = sync.avgPrice[s] ?? 0;
      const pos = m + l;
      positions[s] = r8(pos);
      avgPrice[s] = pos > 0 ? r8((m * ma + l * la) / pos) : 0;
      realized[s] = r8((realized[s] ?? 0) + (sync.realized[s] ?? 0));
    }
  }
  // O robo usa so a parte do nucleo do patrimonio
  return { ...cfg, positions, avgPrice, realized, capitalUsdt: r8(baseCapital(cfg, wallet) * allocOf(cfg).core) };
}

// So as operacoes lancadas a mao formam a posicao manual (as da Lighter vem prontas da conta)
export const manualTrades = <T extends TradeDoc>(list: T[]) => list.filter((t) => t.source !== "lighter");
