// Estrategia diaria (mesma logica do btc_swing_sma_vol.pine e do robo_sinais.py). So gera sinais.
//   Compra  : fechamento acima de SMA150 * (1 + 2%) e HMA 100 subindo
//   Saida   : fechamento abaixo de SMA150 * (1 - 2%) OU a HMA 100 vira para baixo
//   Tamanho : alavancagem max * min(1, alvo de vol / vol 30d)
//   Rebalanco so se a quantidade alvo diferir mais de 25% da posicao atual

export type Kline = [number, number, number, number, number]; // [t, open, high, low, close]

export type Params = {
  sma: number;
  bufferPct: number;
  hma: number;
  volTargetPct: number;
  volWindow: number;
  maxLev: number;
  rebalancePct: number;
  reentry: boolean;
  reentryBandPct: number;
};

export const DEFAULT_PARAMS: Params = {
  sma: 150,
  bufferPct: 2,
  hma: 100,
  volTargetPct: 80,
  volWindow: 30,
  maxLev: 1,
  rebalancePct: 25,
  reentry: false,
  reentryBandPct: 2,
};

export type BarState = {
  t: number;
  close: number;
  sma: number | null;
  hma: number | null;
  vol: number | null;
  st: number;
  hmaDown: boolean;
  turnDown: boolean;
  hmaMult: number;
  stop: number | null;
  expo: number;
  ready: boolean;
};

type Num = number | null;

export function sma(x: number[], n: number): Num[] {
  const out: Num[] = new Array(x.length).fill(null);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function wma(x: Num[], n: number): Num[] {
  const out: Num[] = new Array(x.length).fill(null);
  const w = (n * (n + 1)) / 2;
  for (let i = n - 1; i < x.length; i++) {
    let s = 0;
    let ok = true;
    for (let j = 0; j < n; j++) {
      const v = x[i - n + 1 + j];
      if (v === null) {
        ok = false;
        break;
      }
      s += v * (j + 1);
    }
    if (ok) out[i] = s / w;
  }
  return out;
}

export function hma(x: number[], n: number): Num[] {
  const a = wma(x, Math.floor(n / 2));
  const b = wma(x, n);
  const diff = a.map((u, i) => (u !== null && b[i] !== null ? 2 * u - (b[i] as number) : null));
  const first = diff.findIndex((v) => v !== null);
  if (first < 0) return new Array(x.length).fill(null);
  return [...new Array(first).fill(null), ...wma(diff.slice(first), Math.floor(Math.sqrt(n)))];
}

// Desvio padrao populacional dos retornos log (como ta.stdev do Pine), anualizado com 365 dias
export function volAnn(x: number[], n: number): Num[] {
  const out: Num[] = new Array(x.length).fill(null);
  const r = x.map((v, i) => (i === 0 ? 0 : Math.log(v / x[i - 1])));
  for (let i = n; i < x.length; i++) {
    const w = r.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    out[i] = Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / n) * Math.sqrt(365);
  }
  return out;
}

export function runStrategy(k: Kline[], p: Params = DEFAULT_PARAMS): BarState[] {
  const c = k.map((r) => r[4]);
  const lows = k.map((r) => r[3]);
  const buf = p.bufferPct / 100;
  const band = p.reentryBandPct / 100;
  const m = sma(c, p.sma);
  const h = hma(c, p.hma);
  const v = volAnn(c, p.volWindow);
  let st = 0;
  let hmaMult = 1;
  let reStop: number | null = null;
  let prevDown = false;
  const out: BarState[] = [];
  for (let i = 0; i < c.length; i++) {
    const mi = m[i];
    if (mi !== null) {
      if (c[i] > mi * (1 + buf)) st = 1;
      else if (c[i] < mi * (1 - buf)) st = 0;
    }
    const hi = h[i];
    const hp = i > 0 ? h[i - 1] : null;
    const down = hi !== null && hp !== null && hi < hp;
    const turnDown = down && !prevDown;
    const bounce = mi !== null && c[i] > mi && lows[i] <= mi * (1 + band);
    if (st > 0 && !down) {
      hmaMult = 1;
      reStop = null;
    } else if (st === 0) {
      hmaMult = 0;
      reStop = null;
    } else {
      if (turnDown) {
        hmaMult = 0;
        reStop = null;
      }
      if (reStop !== null && c[i] < reStop) {
        hmaMult = 0;
        reStop = null;
      }
      if (p.reentry && hmaMult === 0 && bounce) {
        hmaMult = 0.5;
        reStop = lows[i];
      }
    }
    const vi = v[i];
    const volMult = vi ? Math.min(1, p.volTargetPct / 100 / vi) : null;
    const ready = volMult !== null && mi !== null && hi !== null;
    const expo = ready ? st * p.maxLev * (volMult as number) * hmaMult : 0;
    out.push({ t: k[i][0], close: c[i], sma: mi, hma: hi, vol: vi, st, hmaDown: down, turnDown, hmaMult, stop: reStop, expo, ready });
    prevDown = down;
  }
  return out;
}

export type Change = { t: number; on: boolean };

export function signalChanges(states: BarState[], last = 8): Change[] {
  const ch: Change[] = [];
  for (let i = 1; i < states.length; i++) {
    const on = states[i].expo > 0;
    if (on !== states[i - 1].expo > 0 && states[i].ready) ch.push({ t: states[i].t, on });
  }
  return ch.slice(-last);
}

export function exitReason(s: BarState): string {
  if (s.st === 0) return "fechou abaixo da SMA (com buffer)";
  if (s.turnDown) return "a HMA virou para baixo";
  return s.hmaDown ? "repique falhou (fechou abaixo do stop)" : "exposicao zerada";
}

export type ActionKind = "COMPRAR" | "REENTRADA" | "VENDER_TUDO" | "COMPRAR_MAIS" | "VENDER_PARTE" | "MANTER" | "FICAR_FORA";

export type Decision = { kind: ActionKind; label: string; qty: number; targetQty: number };

// Compara a exposicao alvo do ultimo candle fechado com a posicao atual (em moedas)
export function decide(s: BarState, capitalUsdt: number, position: number, p: Params = DEFAULT_PARAMS): Decision {
  const targetQty = (s.expo * capitalUsdt) / s.close;
  if (s.expo > 0 && position <= 0) {
    const re = s.hmaMult === 0.5;
    return { kind: re ? "REENTRADA" : "COMPRAR", label: re ? "REENTRADA (meia posicao)" : "COMPRAR", qty: targetQty, targetQty };
  }
  if (s.expo === 0 && position > 0) return { kind: "VENDER_TUDO", label: `VENDER TUDO - ${exitReason(s)}`, qty: position, targetQty };
  if (s.expo > 0 && position > 0) {
    const diff = targetQty - position;
    if (Math.abs(diff) / position > p.rebalancePct / 100) {
      return diff > 0
        ? { kind: "COMPRAR_MAIS", label: "REBALANCEAR: comprar mais", qty: diff, targetQty }
        : { kind: "VENDER_PARTE", label: "REBALANCEAR: vender parte", qty: -diff, targetQty };
    }
    return { kind: "MANTER", label: "MANTER a posicao", qty: 0, targetQty };
  }
  return { kind: "FICAR_FORA", label: "FICAR FORA", qty: 0, targetQty };
}
