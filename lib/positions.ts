import type { AppConfig, LighterSyncDoc, TradeDoc } from "./types";

const r8 = (v: number) => Math.round(v * 1e8) / 1e8;

// Posicao efetiva = operacoes lancadas a mao (config) + conta da Lighter (sync/lighter), com preco medio ponderado
export function effectiveConfig(cfg: AppConfig, sync: LighterSyncDoc | null | undefined): AppConfig {
  if (!sync || !cfg.lighter?.enabled) return cfg;
  const positions = { ...cfg.positions };
  const avgPrice = { ...(cfg.avgPrice ?? {}) };
  const realized = { ...(cfg.realized ?? {}) };
  for (const [s, l] of Object.entries(sync.positions)) {
    const m = positions[s] ?? 0;
    const ma = avgPrice[s] ?? 0;
    const la = sync.avgPrice[s] ?? 0;
    const pos = m + l;
    positions[s] = r8(pos);
    avgPrice[s] = pos > 0 ? r8((m * ma + l * la) / pos) : 0;
    realized[s] = r8((realized[s] ?? 0) + (sync.realized[s] ?? 0));
  }
  return { ...cfg, positions, avgPrice, realized };
}

// So as operacoes lancadas a mao formam a posicao manual (as da Lighter vem prontas da conta)
export const manualTrades = <T extends TradeDoc>(list: T[]) => list.filter((t) => t.source !== "lighter");
