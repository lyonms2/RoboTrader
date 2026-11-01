"use client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db, firebaseConfigured } from "@/lib/firebaseClient";
import { DEFAULT_PARAMS, decide } from "@/lib/strategy";
import { DEFAULT_CONFIG, type AppConfig, type LatestDoc, type TradeDoc } from "@/lib/types";
import Chart from "./Chart";
import { usePrices, type Prices } from "./usePrices";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "agora" : `ha ${m} min`;
};
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${fmt(v, d)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

// Preco atual: Binance ao vivo (30 s) ou, se indisponivel, o do ultimo recalculo do servidor
function currentPrice(l: LatestDoc, prices: Prices): { price: number; at: number; live: boolean } {
  const live = prices.values[l.symbol];
  if (live && prices.at) return { price: live, at: prices.at, live: true };
  return { price: l.preview?.state.close ?? l.state.close, at: l.updatedAt, live: false };
}

// Lucro/prejuizo da posicao aberta (sem taxas e funding)
function openPnl(cfg: AppConfig, symbol: string, price: number) {
  const pos = cfg.positions[symbol] ?? 0;
  const avg = cfg.avgPrice?.[symbol] ?? 0;
  if (!(pos > 0 && avg > 0)) return { usdt: 0, pct: 0, known: !(pos > 0) };
  return { usdt: pos * (price - avg), pct: (price / avg - 1) * 100, known: true };
}

// Campo numerico que aceita digitar "0," ou "0.004" antes de virar numero
function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t.replace(",", ".")) === value ? t : String(value)));
  }, [value]);
  return (
    <input value={text} inputMode="decimal"
      onChange={(e) => { setText(e.target.value); onChange(Number(e.target.value.replace(",", ".")) || 0); }} />
  );
}

export default function Page() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [latest, setLatest] = useState<LatestDoc[]>([]);
  const [trades, setTrades] = useState<(TradeDoc & { id: string })[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const prices = usePrices(user ? Object.keys(cfg.weights) : []);

  useEffect(() => (firebaseConfigured ? onAuthStateChanged(auth(), setUser) : setUser(null)), []);

  useEffect(() => {
    if (!user) return;
    const onErr = (e: Error) => setError(e.message.includes("permission") ? "Este e-mail nao tem acesso (veja firestore.rules)." : e.message);
    const u1 = onSnapshot(doc(db(), "config/main"), (s) => s.exists() && setCfg({ ...DEFAULT_CONFIG, ...(s.data() as AppConfig) }), onErr);
    const u2 = onSnapshot(collection(db(), "latest"), (s) => setLatest(s.docs.map((d) => d.data() as LatestDoc)), onErr);
    const u3 = onSnapshot(query(collection(db(), "trades"), orderBy("t", "desc"), limit(20)),
      (s) => setTrades(s.docs.map((d) => ({ id: d.id, ...(d.data() as TradeDoc) }))), onErr);
    return () => { u1(); u2(); u3(); };
  }, [user]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
      if (!res.ok) setError(`Recalcular falhou: ${(await res.json()).error}`);
    } finally {
      setBusy(false);
    }
  }

  if (!firebaseConfigured)
    return <main className="wrap center"><h1>Robo de Sinais</h1><p className="error">Firebase nao configurado: cadastre as variaveis NEXT_PUBLIC_FIREBASE_* na Vercel e faca Redeploy.</p></main>;
  if (user === undefined) return <main className="wrap"><p>Carregando...</p></main>;
  if (!user)
    return (
      <main className="wrap center">
        <h1>Robo de Sinais</h1>
        <p className="muted">Estrategia diaria SMA 150 + HMA 100 + alvo de vol. So sinais: voce opera manualmente.</p>
        <button onClick={() => signInWithPopup(auth(), new GoogleAuthProvider())}>Entrar com Google</button>
      </main>
    );

  return (
    <main className="wrap">
      <header>
        <h1>Robo de Sinais</h1>
        <div className="row">
          <button onClick={refresh} disabled={busy}>{busy ? "Calculando..." : "Recalcular agora"}</button>
          <button className="ghost" onClick={() => signOut(auth())}>Sair</button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {!latest.length && !error && <p className="muted">Nenhum sinal ainda. Clique em &quot;Recalcular agora&quot;.</p>}

      {latest.length > 0 && <Summary cfg={cfg} latest={latest} prices={prices} />}

      <div className="grid">
        {[...latest].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((l) => (
          <AssetCard key={l.symbol} l={l} cfg={cfg} prices={prices} />
        ))}
      </div>

      <TradeForm cfg={cfg} latest={latest} prices={prices} />
      <ConfigForm cfg={cfg} />

      <section className="card">
        <h2>Operacoes registradas</h2>
        {trades.length ? (
          <table>
            <thead><tr><th>Data</th><th>Ativo</th><th>Lado</th><th>Qtd</th><th>Preco</th></tr></thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}><td>{new Date(t.t).toLocaleString("pt-BR")}</td><td>{t.symbol}</td><td>{t.side}</td><td>{fmt(t.qty, 4)}</td><td>{fmt(t.price)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">Nenhuma ainda.</p>}
      </section>
      <p className="muted small">Ferramenta educacional. Nao e recomendacao de investimento. O candle diario fecha as 21:00 (Brasilia).</p>
    </main>
  );
}

function Summary({ cfg, latest, prices }: { cfg: AppConfig; latest: LatestDoc[]; prices: Prices }) {
  let open = 0;
  let invested = 0;
  let value = 0;
  let unknown = false;
  for (const l of latest) {
    const { price } = currentPrice(l, prices);
    const p = openPnl(cfg, l.symbol, price);
    const pos = cfg.positions[l.symbol] ?? 0;
    open += p.usdt;
    unknown ||= !p.known;
    invested += pos * (cfg.avgPrice?.[l.symbol] ?? 0);
    value += pos * price;
  }
  const realized = Object.values(cfg.realized ?? {}).reduce((a, b) => a + b, 0);
  return (
    <section className="card summary">
      <div><span className="muted small">Em posicao agora</span><b>{fmt(value)} USDT</b></div>
      <div><span className="muted small">Lucro/prejuizo aberto</span>
        <b className={pnlClass(open)}>{signed(open)} USDT{invested > 0 ? ` (${signed((open / invested) * 100, 1)}%)` : ""}</b></div>
      <div><span className="muted small">Realizado (vendas)</span><b className={pnlClass(realized)}>{signed(realized)} USDT</b></div>
      <div><span className="muted small">Total</span><b className={pnlClass(open + realized)}>{signed(open + realized)} USDT</b></div>
      {unknown && <p className="warn small full">Ha posicao sem preco medio: informe-o em Configuracao para calcular o lucro.</p>}
      <p className="muted small full">Sem taxas e sem funding. Preco {prices.at ? `ao vivo da Binance (${ago(prices.at)})` : "do ultimo recalculo"}.</p>
    </section>
  );
}

function AssetCard({ l, cfg, prices }: { l: LatestDoc; cfg: AppConfig; prices: Prices }) {
  const s = l.state;
  const cur = currentPrice(l, prices);
  const pnl = openPnl(cfg, l.symbol, cur.price);
  const avg = cfg.avgPrice?.[l.symbol] ?? 0;
  const realized = cfg.realized?.[l.symbol] ?? 0;
  const coin = l.symbol.replace("USDT", "");
  const capital = cfg.capitalUsdt * (cfg.weights[l.symbol] ?? 0);
  const pos = cfg.positions[l.symbol] ?? 0;
  const d = decide(s, capital, pos, { ...DEFAULT_PARAMS, reentry: cfg.reentry });
  const tone = d.kind === "VENDER_TUDO" || d.kind === "VENDER_PARTE" ? "sell" : d.qty > 0 ? "buy" : "hold";
  const buf = DEFAULT_PARAMS.bufferPct / 100;
  const ps = l.preview?.state;
  const pd = ps ? decide(ps, capital, pos, { ...DEFAULT_PARAMS, reentry: cfg.reentry }) : null;
  return (
    <section className="card">
      <div className="row between">
        <h2>{l.symbol}</h2>
        <span className="muted small">candle {day(s.t)}</span>
      </div>
      <div className={`action ${tone}`}>
        {d.label}
        {d.qty > 0 && <span> {fmt(d.qty, 4)} {coin} (~{fmt(d.qty * s.close, 0)} USDT)</span>}
      </div>
      {pd && ps && (
        <p className={`preview small ${pd.kind !== d.kind ? "warn" : "muted"}`}>
          Previa (candle de hoje, aberto) a {fmt(ps.close)}: se fechar agora, {pd.kind !== d.kind ? <b>{pd.label}</b> : "sem mudanca"}.
          {" "}Vale so no fechamento das 21:00.
        </p>
      )}
      <div className="price-row">
        <div>
          <span className="muted small">Preco atual ({cur.live ? `ao vivo, ${ago(cur.at)}` : `recalculo ${ago(cur.at)}`})</span>
          <b>{fmt(cur.price)}</b>
        </div>
        {pos > 0 && (
          <div>
            <span className="muted small">Lucro/prejuizo</span>
            <b className={pnlClass(pnl.usdt)}>{avg > 0 ? `${signed(pnl.usdt)} USDT (${signed(pnl.pct, 1)}%)` : "informe o preco medio"}</b>
          </div>
        )}
      </div>
      <p className="muted small">Sinal recalculado {ago(l.updatedAt)}</p>
      <Chart chart={l.chart} />
      <p className="legend small"><i className="k-close" /> preco <i className="k-sma" /> SMA {DEFAULT_PARAMS.sma} <i className="k-hma" /> HMA {DEFAULT_PARAMS.hma} <i className="k-band" /> comprado</p>
      <dl>
        <dt>Fechamento</dt><dd>{fmt(s.close)}</dd>
        <dt>SMA {DEFAULT_PARAMS.sma}</dt><dd>{fmt(s.sma ?? 0)} ({fmt(((s.close / (s.sma ?? s.close)) - 1) * 100, 1)}%)</dd>
        <dt>Compra acima / sai abaixo</dt><dd>{fmt((s.sma ?? 0) * (1 + buf), 0)} / {fmt((s.sma ?? 0) * (1 - buf), 0)}</dd>
        <dt>HMA {DEFAULT_PARAMS.hma}</dt><dd className={s.hmaDown ? "warn" : ""}>{s.hmaDown ? "CAINDO" : "subindo"}{s.turnDown ? " (virou hoje)" : ""}</dd>
        <dt>Volatilidade 30d</dt><dd>{fmt((s.vol ?? 0) * 100, 0)}% ao ano</dd>
        <dt>Exposicao alvo</dt><dd>{fmt(s.expo)}x = {fmt(d.targetQty, 4)} {coin}</dd>
        <dt>Sua posicao</dt><dd>{fmt(pos, 4)} {coin}{pos > 0 && avg > 0 ? ` a ${fmt(avg)}` : ""}</dd>
        {realized !== 0 && <><dt>Realizado</dt><dd className={pnlClass(realized)}>{signed(realized)} USDT</dd></>}
        {s.stop !== null && <><dt>Stop da reentrada</dt><dd>{fmt(s.stop)}</dd></>}
      </dl>
      <p className="muted small">Ultimos sinais: {l.changes.map((c) => `${day(c.t)} ${c.on ? "compra" : "saida"}`).join(", ") || "-"}</p>
    </section>
  );
}

function TradeForm({ cfg, latest, prices }: { cfg: AppConfig; latest: LatestDoc[]; prices: Prices }) {
  const symbols = Object.keys(cfg.weights);
  const [symbol, setSymbol] = useState(symbols[0] ?? "BTCUSDT");
  const [side, setSide] = useState<"compra" | "venda">("compra");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    const q = Number(qty.replace(",", "."));
    const l = latest.find((x) => x.symbol === symbol);
    const p = Number(price.replace(",", ".")) || (l ? currentPrice(l, prices).price : 0);
    if (!(q > 0)) return setMsg("Informe a quantidade.");
    if (!(p > 0)) return setMsg("Informe o preco.");
    const cur = cfg.positions[symbol] ?? 0;
    const avg = cfg.avgPrice?.[symbol] ?? 0;
    let realized = cfg.realized?.[symbol] ?? 0;
    let next: number;
    let nextAvg: number;
    if (side === "compra") {
      next = cur + q;
      nextAvg = cur > 0 && avg > 0 ? (cur * avg + q * p) / next : p; // preco medio ponderado
    } else {
      const sold = Math.min(q, cur);
      next = cur - sold;
      if (avg > 0) realized += sold * (p - avg); // lucro da parte vendida contra o preco medio
      nextAvg = next > 1e-12 ? avg : 0;
    }
    await addDoc(collection(db(), "trades"), { symbol, side, qty: q, price: p, t: Date.now() } satisfies TradeDoc);
    await setDoc(doc(db(), "config/main"),
      { positions: { [symbol]: next }, avgPrice: { [symbol]: nextAvg }, realized: { [symbol]: realized } }, { merge: true });
    setQty("");
    setPrice("");
    setMsg(`Registrado. Posicao em ${symbol}: ${fmt(next, 4)}${next > 0 ? ` a preco medio ${fmt(nextAvg)}` : ""}.`);
  }

  return (
    <section className="card">
      <h2>Registrar operacao (depois de operar na corretora)</h2>
      <div className="row wrap-row">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{symbols.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={side} onChange={(e) => setSide(e.target.value as "compra" | "venda")}><option value="compra">compra</option><option value="venda">venda</option></select>
        <input placeholder="quantidade" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        <input placeholder="preco (vazio = atual)" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        <button onClick={save}>Registrar</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}

function ConfigForm({ cfg }: { cfg: AppConfig }) {
  const [draft, setDraft] = useState(cfg);
  const [msg, setMsg] = useState("");
  useEffect(() => setDraft(cfg), [cfg]);

  async function save() {
    await setDoc(doc(db(), "config/main"), draft);
    setMsg("Salvo. Os cartoes ja usam os novos valores.");
  }

  return (
    <section className="card">
      <h2>Configuracao</h2>
      <div className="row wrap-row">
        <label>Capital (USDT) <NumInput value={draft.capitalUsdt} onChange={(v) => setDraft({ ...draft, capitalUsdt: v })} /></label>
        {Object.keys(draft.weights).map((s) => (
          <label key={s}>Peso {s} <NumInput value={draft.weights[s]} onChange={(v) => setDraft({ ...draft, weights: { ...draft.weights, [s]: v } })} /></label>
        ))}
        {Object.keys(draft.weights).map((s) => (
          <label key={`p${s}`}>Posicao {s} <NumInput value={draft.positions[s] ?? 0} onChange={(v) => setDraft({ ...draft, positions: { ...draft.positions, [s]: v } })} /></label>
        ))}
        {Object.keys(draft.weights).map((s) => (
          <label key={`a${s}`}>Preco medio {s} <NumInput value={draft.avgPrice?.[s] ?? 0} onChange={(v) => setDraft({ ...draft, avgPrice: { ...draft.avgPrice, [s]: v } })} /></label>
        ))}
        <label className="check"><input type="checkbox" checked={draft.reentry} onChange={(e) => setDraft({ ...draft, reentry: e.target.checked })} /> Reentrada no repique (meia posicao)</label>
        <button onClick={save}>Salvar</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      {Math.abs(Object.values(draft.weights).reduce((a, b) => a + b, 0) - 1) > 0.011 && (
        <p className="warn small">A soma dos pesos e {fmt(Object.values(draft.weights).reduce((a, b) => a + b, 0))}: o normal e 1 (100% do capital).</p>
      )}
      <p className="muted small">A reentrada muda o calculo do servidor: clique em &quot;Recalcular agora&quot; depois de alterar.</p>
    </section>
  );
}
