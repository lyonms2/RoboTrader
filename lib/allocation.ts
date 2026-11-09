import { allocOf } from "./positions";
import { walletTotals } from "./walletMath";
import type { AppConfig, FichaDoc, LatestDoc, WalletDoc } from "./types";

const COINS = ["BTC", "ETH", "SOL"];
const IN_SYSTEM = ["manter", "reduzir", "entrada", "entrada_metade", "tendencia", "saida"];

export type Block = { name: string; hint: string; target: number | null; real: number };

// Blocos da carteira: nucleo (robo), satelite (rompimento), fora do sistema e dolar. cfg = configuracao efetiva
// (capitalUsdt ja e o capital do nucleo).
export function allocationBlocks(wallet: WalletDoc, cfg: AppConfig, latest: LatestDoc[], fichas: FichaDoc | null): Block[] {
  const { byClass, perpExpo } = walletTotals(wallet);
  const alloc = allocOf(cfg);
  const coreTarget = COINS.reduce((s, c) => s + (latest.find((x) => x.symbol === `${c}USDT`)?.state.expo ?? 0) * (cfg.weights[`${c}USDT`] ?? 0) * cfg.capitalUsdt, 0);
  const coreReal = byClass.BTC + byClass.ETH + byClass.SOL + Object.values(perpExpo).reduce((s, v) => s + v, 0);
  const sat = (fichas?.items ?? []).filter((f) => !COINS.includes(f.symbol));
  const satReal = sat.filter((f) => IN_SYSTEM.includes(f.situacao?.code ?? "")).reduce((s, f) => s + f.held, 0);
  const satTarget = sat.reduce((s, f) => s + (f.target ?? 0), 0);
  return [
    { name: "Núcleo", hint: "BTC/ETH/SOL pelo robô", target: coreTarget, real: coreReal },
    { name: "Satélite", hint: "rompimento 55/20", target: alloc.satellite > 0 ? satTarget : 0, real: satReal },
    { name: "Fora do sistema", hint: "tokens sem regra", target: 0, real: Math.max(0, byClass.outro - satReal) },
    { name: "Dólar", hint: "stablecoins rendendo", target: null, real: byClass.stable },
  ];
}

// Avisos da carteira: vencimentos (Pendle), recompensas, alavancagem nos perpetuos e erros de leitura
export function walletNotices(wallet: WalletDoc) {
  const out: { level: "warn" | "info" | "error"; text: string }[] = [];
  const lt = wallet.lighter;
  const notional = (lt?.perps ?? []).reduce((s, p) => s + p.notional, 0);
  if (lt && lt.value > 0 && notional / lt.value > 1.01)
    out.push({ level: "warn", text: `Lighter com alavancagem de ${(notional / lt.value).toFixed(2)}x sobre a margem (a estratégia usa 1x)` });
  for (const i of wallet.items) {
    if (i.maturity !== null) {
      const days = Math.ceil((i.maturity - Date.now()) / 86_400_000);
      out.push({ level: days <= 14 ? "warn" : "info", text: `${i.symbol} (${i.app}) ${days > 0 ? `vence em ${days} dias` : "já venceu: resgate"} - $${i.value.toFixed(2)}` });
    }
    if (i.type === "reward") out.push({ level: "info", text: `Recompensa para resgatar: ${i.qty.toFixed(4)} ${i.symbol} (${i.app}, $${i.value.toFixed(2)})` });
  }
  for (const e of wallet.errors) out.push({ level: "error", text: `Leitura da carteira: ${e}` });
  return out;
}
