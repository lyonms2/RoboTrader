"use client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db, firebaseConfigured } from "@/lib/firebaseClient";
import { DEFAULT_PARAMS, decide } from "@/lib/strategy";
import { DEFAULT_CONFIG, type AppConfig, type LatestDoc, type TradeDoc } from "@/lib/types";
import Chart from "./Chart";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });

export default function Page() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [latest, setLatest] = useState<LatestDoc[]>([]);
  const [trades, setTrades] = useState<(TradeDoc & { id: string })[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

      <div className="grid">
        {[...latest].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((l) => (
          <AssetCard key={l.symbol} l={l} cfg={cfg} />
        ))}
      </div>

      <TradeForm cfg={cfg} latest={latest} />
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

function AssetCard({ l, cfg }: { l: LatestDoc; cfg: AppConfig }) {
  const s = l.state;
  const coin = l.symbol.replace("USDT", "");
  const capital = cfg.capitalUsdt * (cfg.weights[l.symbol] ?? 0);
  const pos = cfg.positions[l.symbol] ?? 0;
  const d = decide(s, capital, pos, { ...DEFAULT_PARAMS, reentry: cfg.reentry });
  const tone = d.kind === "VENDER_TUDO" || d.kind === "VENDER_PARTE" ? "sell" : d.qty > 0 ? "buy" : "hold";
  const buf = DEFAULT_PARAMS.bufferPct / 100;
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
      <Chart chart={l.chart} />
      <p className="legend small"><i className="k-close" /> preco <i className="k-sma" /> SMA {DEFAULT_PARAMS.sma} <i className="k-hma" /> HMA {DEFAULT_PARAMS.hma} <i className="k-band" /> comprado</p>
      <dl>
        <dt>Fechamento</dt><dd>{fmt(s.close)}</dd>
        <dt>SMA {DEFAULT_PARAMS.sma}</dt><dd>{fmt(s.sma ?? 0)} ({fmt(((s.close / (s.sma ?? s.close)) - 1) * 100, 1)}%)</dd>
        <dt>Compra acima / sai abaixo</dt><dd>{fmt((s.sma ?? 0) * (1 + buf), 0)} / {fmt((s.sma ?? 0) * (1 - buf), 0)}</dd>
        <dt>HMA {DEFAULT_PARAMS.hma}</dt><dd className={s.hmaDown ? "warn" : ""}>{s.hmaDown ? "CAINDO" : "subindo"}{s.turnDown ? " (virou hoje)" : ""}</dd>
        <dt>Volatilidade 30d</dt><dd>{fmt((s.vol ?? 0) * 100, 0)}% ao ano</dd>
        <dt>Exposicao alvo</dt><dd>{fmt(s.expo)}x = {fmt(d.targetQty, 4)} {coin}</dd>
        <dt>Sua posicao</dt><dd>{fmt(pos, 4)} {coin}</dd>
        {s.stop !== null && <><dt>Stop da reentrada</dt><dd>{fmt(s.stop)}</dd></>}
      </dl>
      <p className="muted small">Ultimos sinais: {l.changes.map((c) => `${day(c.t)} ${c.on ? "compra" : "saida"}`).join(", ") || "-"}</p>
    </section>
  );
}

function TradeForm({ cfg, latest }: { cfg: AppConfig; latest: LatestDoc[] }) {
  const symbols = Object.keys(cfg.weights);
  const [symbol, setSymbol] = useState(symbols[0] ?? "BTCUSDT");
  const [side, setSide] = useState<"compra" | "venda">("compra");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    const q = Number(qty.replace(",", "."));
    const p = Number(price.replace(",", ".")) || latest.find((l) => l.symbol === symbol)?.state.close || 0;
    if (!(q > 0)) return setMsg("Informe a quantidade.");
    const cur = cfg.positions[symbol] ?? 0;
    const next = Math.max(0, side === "compra" ? cur + q : cur - q);
    await addDoc(collection(db(), "trades"), { symbol, side, qty: q, price: p, t: Date.now() } satisfies TradeDoc);
    await setDoc(doc(db(), "config/main"), { positions: { [symbol]: next } }, { merge: true });
    setQty("");
    setPrice("");
    setMsg(`Registrado. Posicao em ${symbol}: ${fmt(next, 4)}`);
  }

  return (
    <section className="card">
      <h2>Registrar operacao (depois de operar na corretora)</h2>
      <div className="row wrap-row">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{symbols.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={side} onChange={(e) => setSide(e.target.value as "compra" | "venda")}><option value="compra">compra</option><option value="venda">venda</option></select>
        <input placeholder="quantidade" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        <input placeholder="preco (opcional)" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
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
  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  async function save() {
    await setDoc(doc(db(), "config/main"), draft);
    setMsg("Salvo. Os cartoes ja usam os novos valores.");
  }

  return (
    <section className="card">
      <h2>Configuracao</h2>
      <div className="row wrap-row">
        <label>Capital (USDT) <input value={draft.capitalUsdt} onChange={(e) => setDraft({ ...draft, capitalUsdt: num(e.target.value) })} inputMode="decimal" /></label>
        {Object.keys(draft.weights).map((s) => (
          <label key={s}>Peso {s} <input value={draft.weights[s]} onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [s]: num(e.target.value) } })} inputMode="decimal" /></label>
        ))}
        {Object.keys(draft.weights).map((s) => (
          <label key={`p${s}`}>Posicao {s} <input value={draft.positions[s] ?? 0} onChange={(e) => setDraft({ ...draft, positions: { ...draft.positions, [s]: num(e.target.value) } })} inputMode="decimal" /></label>
        ))}
        <label className="check"><input type="checkbox" checked={draft.reentry} onChange={(e) => setDraft({ ...draft, reentry: e.target.checked })} /> Reentrada no repique (meia posicao)</label>
        <button onClick={save}>Salvar</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">A reentrada muda o calculo do servidor: clique em &quot;Recalcular agora&quot; depois de alterar.</p>
    </section>
  );
}
