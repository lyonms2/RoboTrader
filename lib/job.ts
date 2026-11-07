import { adminDb } from "./firebaseAdmin";
import { fetchDaily } from "./market";
import { DEFAULT_PARAMS, decide, runStrategy, signalChanges, signalEvents } from "./strategy";
import { DEFAULT_CONFIG, SYMBOLS, type AppConfig, type LatestDoc, type LighterSyncDoc } from "./types";
import { syncLighter } from "./lighter";
import { effectiveConfig } from "./positions";
import { isAddress, refreshWallet } from "./wallet";

const CHART_DAYS = 240;
// Trava contra chamadas repetidas: o agendador roda a cada 15 min; abaixo disso o calculo e ignorado
const MIN_INTERVAL_MS = 5 * 60_000;

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

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

// Calcula o sinal oficial (candles fechados) e a previa (candle de hoje como se fechasse agora) de cada ativo,
// grava latest/{ativo} e history/{ativo}_{data} e avisa no Telegram uma unica vez por candle.
// force = botao "Recalcular agora" (ignora a trava de frequencia).
export async function runJob({ force }: { force: boolean }) {
  const db = adminDb();
  const now = Date.now();
  const runRef = db.doc("meta/run");
  const allowed = await db.runTransaction(async (tx) => {
    const last = ((await tx.get(runRef)).data()?.lastRun as number | undefined) ?? 0;
    if (!force && now - last < MIN_INTERVAL_MS) return false;
    tx.set(runRef, { lastRun: now }, { merge: true });
    return true;
  });
  if (!allowed) return { skipped: true, results: [] };

  const cfgSnap = await db.doc("config/main").get();
  const cfg: AppConfig = { ...DEFAULT_CONFIG, ...(cfgSnap.data() as Partial<AppConfig> | undefined) };
  // Ativo novo (ex.: SOL adicionada depois): entra com o peso padrao e posicao zero; ajuste no painel
  const missing = SYMBOLS.filter((s) => cfg.weights[s] === undefined);
  for (const s of missing) {
    cfg.weights = { ...cfg.weights, [s]: DEFAULT_CONFIG.weights[s] };
    cfg.positions = { ...cfg.positions, [s]: cfg.positions[s] ?? 0 };
  }
  if (!cfgSnap.exists || missing.length) await db.doc("config/main").set(cfg);
  // Lighter: posicoes e operacoes automaticas (API publica). Uma falha aqui nao impede os sinais.
  let lighter: unknown = null;
  let eff = cfg;
  if (cfg.lighter?.enabled && isAddress(cfg.wallet)) {
    try {
      lighter = await syncLighter(cfg.wallet, cfg.lighter.since);
      const sync = (await db.doc("sync/lighter").get()).data() as LighterSyncDoc | undefined;
      eff = effectiveConfig(cfg, sync);
    } catch (e) {
      lighter = { error: String(e) };
    }
  }
  const params = { ...DEFAULT_PARAMS, reentry: cfg.reentry };
  const notifyRef = db.doc("meta/notify");
  const notified = ((await notifyRef.get()).data() ?? {}) as Record<string, string>;
  const official: string[] = [];
  const forming: string[] = [];
  const results: { symbol: string; label: string; qty: number; day: string; preview: string | null }[] = [];

  for (const symbol of SYMBOLS) {
    const { closed, open } = await fetchDaily(symbol);
    const states = runStrategy(closed, params);
    const s = states[states.length - 1];
    const capital = cfg.capitalUsdt * (cfg.weights[symbol] ?? 0);
    const pos = eff.positions[symbol] ?? 0;
    const decision = decide(s, capital, pos, params);
    const pStates = open ? runStrategy([...closed, open], params) : null;
    const ps = pStates ? pStates[pStates.length - 1] : null;
    const pDecision = ps ? decide(ps, capital, pos, params) : null;
    const tail = states.slice(-CHART_DAYS);
    const doc: LatestDoc = {
      symbol,
      state: s,
      decision,
      changes: signalChanges(states),
      events: signalEvents(states),
      chart: {
        t: tail.map((x) => x.t),
        close: tail.map((x) => x.close),
        sma: tail.map((x) => x.sma),
        hma: tail.map((x) => x.hma),
        on: tail.map((x) => x.expo > 0),
        expo: tail.map((x) => x.expo),
      },
      preview: ps && pDecision ? { state: ps, decision: pDecision } : null,
      updatedAt: now,
    };
    const day = dayOf(s.t);
    await db.doc(`latest/${symbol}`).set(doc);
    await db.doc(`history/${symbol}_${day}`).set({ symbol, day, state: s, decision, position: pos });
    results.push({ symbol, label: decision.label, qty: decision.qty, day, preview: pDecision?.label ?? null });

    // Sinal oficial: avisa uma vez por candle fechado
    const offKey = `${day}:${decision.kind}`;
    if (decision.qty > 0 && notified[symbol] !== offKey) {
      official.push(`${symbol}: ${decision.label} ${decision.qty.toFixed(4)}`);
      notified[symbol] = offKey;
    }
    // Sinal em formacao (opcional): avisa uma vez por dia se o candle de hoje, fechando agora, mudaria a acao
    if (process.env.TELEGRAM_PREVIEW_ALERTS === "1" && ps && pDecision && pDecision.qty > 0 && pDecision.kind !== decision.kind) {
      const key = `${dayOf(ps.t)}:${pDecision.kind}`;
      if (notified[`${symbol}_preview`] !== key) {
        forming.push(`${symbol}: se fechar agora -> ${pDecision.label} (preco ${ps.close.toFixed(2)})`);
        notified[`${symbol}_preview`] = key;
      }
    }
  }

  if (official.length) {
    await telegram(`Robo de sinais - SINAL OFICIAL (candle ${results[0].day})\n${official.join("\n")}\n\nNao e recomendacao de investimento.`);
  }
  if (forming.length) {
    await telegram(`Robo de sinais - sinal EM FORMACAO (o candle ainda nao fechou; pode mudar ate 21:00)\n${forming.join("\n")}`);
  }
  if (official.length || forming.length) await notifyRef.set(notified);
  let wallet: unknown = null;
  if (!force) {
    try {
      wallet = await refreshWallet({ force: false });
    } catch (e) {
      wallet = { error: String(e) };
    }
  }
  return { skipped: false, results, wallet, lighter };
}
