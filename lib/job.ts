import { adminDb } from "./firebaseAdmin";
import { fetchDaily } from "./market";
import { DEFAULT_PARAMS, decide, runStrategy, signalChanges } from "./strategy";
import { DEFAULT_CONFIG, SYMBOLS, type AppConfig, type LatestDoc } from "./types";

const CHART_DAYS = 240;

async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
}

// Calcula o sinal de cada ativo, grava latest/{ativo} e history/{ativo}_{data} e avisa no Telegram se houver acao
export async function runJob({ notify }: { notify: boolean }) {
  const db = adminDb();
  const cfgSnap = await db.doc("config/main").get();
  const cfg: AppConfig = { ...DEFAULT_CONFIG, ...(cfgSnap.data() as Partial<AppConfig> | undefined) };
  // Ativo novo (ex.: SOL adicionada depois): entra com o peso padrao e posicao zero; ajuste no painel
  const missing = SYMBOLS.filter((s) => cfg.weights[s] === undefined);
  for (const s of missing) {
    cfg.weights = { ...cfg.weights, [s]: DEFAULT_CONFIG.weights[s] };
    cfg.positions = { ...cfg.positions, [s]: cfg.positions[s] ?? 0 };
  }
  if (!cfgSnap.exists || missing.length) await db.doc("config/main").set(cfg);
  const params = { ...DEFAULT_PARAMS, reentry: cfg.reentry };
  const results: { symbol: string; label: string; qty: number; day: string }[] = [];

  for (const symbol of SYMBOLS) {
    const states = runStrategy(await fetchDaily(symbol), params);
    const s = states[states.length - 1];
    const capital = cfg.capitalUsdt * (cfg.weights[symbol] ?? 0);
    const decision = decide(s, capital, cfg.positions[symbol] ?? 0, params);
    const tail = states.slice(-CHART_DAYS);
    const doc: LatestDoc = {
      symbol,
      state: s,
      decision,
      changes: signalChanges(states),
      chart: {
        t: tail.map((x) => x.t),
        close: tail.map((x) => x.close),
        sma: tail.map((x) => x.sma),
        hma: tail.map((x) => x.hma),
        on: tail.map((x) => x.expo > 0),
      },
      updatedAt: Date.now(),
    };
    const day = new Date(s.t).toISOString().slice(0, 10);
    await db.doc(`latest/${symbol}`).set(doc);
    await db.doc(`history/${symbol}_${day}`).set({ symbol, day, state: s, decision, position: cfg.positions[symbol] ?? 0 });
    results.push({ symbol, label: decision.label, qty: decision.qty, day });
  }

  const actionable = results.filter((r) => r.qty > 0);
  if (notify && actionable.length) {
    const lines = actionable.map((r) => `${r.symbol}: ${r.label} ${r.qty.toFixed(4)}`);
    await telegram(`Robo de sinais (candle ${results[0].day})\n${lines.join("\n")}\n\nNao e recomendacao de investimento.`);
  }
  return results;
}
