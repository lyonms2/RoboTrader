"use client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { addDoc, collection, doc, getDocs, limitToLast, onSnapshot, orderBy, query, setDoc, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db, firebaseConfigured } from "@/lib/firebaseClient";
import { applyTrade, rebuild } from "@/lib/ledger";
import { performance } from "@/lib/performance";
import { effectiveConfig } from "@/lib/positions";
import { isEvmAddress, isSolAddress } from "@/lib/addresses";
import { DEFAULT_PARAMS, decide } from "@/lib/strategy";
import { DEFAULT_CONFIG, SYMBOLS, type AppConfig, type LatestDoc, type FichaDoc, type LighterSyncDoc, type TradeDoc, type WalletDoc, type WalletHistoryDoc } from "@/lib/types";
import Chart from "./Chart";
import PerfChart from "./PerfChart";
import WalletCard from "./WalletCard";
import FichasCard from "./FichasCard";
import { usePrices, type Prices } from "./usePrices";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// Sem arredondar: quantidades com ate 8 casas (precisao da corretora) e precos com 2 a 8 casas
const fmtQty = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const fmtPx = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
const day = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "agora" : `ha ${m} min`;
};
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${fmt(v, d)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
// Evita lixo de ponto flutuante (0.022719999999999997) nas quantidades e precos salvos
const round8 = (v: number) => Math.round(v * 1e8) / 1e8;
// Moedas na ordem fixa BTC, ETH, SOL (o Firestore nao garante a ordem das chaves)
const ordered = (keys: string[]) =>
  [...keys].sort((a, b) => (SYMBOLS.indexOf(a) + 1 || 99) - (SYMBOLS.indexOf(b) + 1 || 99));

type Px = { price: number; at: number; live: boolean };

// Preco atual: Binance ao vivo (30 s) ou, se indisponivel, o do ultimo recalculo do servidor
function priceOf(symbol: string, latest: LatestDoc[], prices: Prices): Px | null {
  const live = prices.values[symbol];
  if (live && prices.at) return { price: live, at: prices.at, live: true };
  const l = latest.find((x) => x.symbol === symbol);
  return l ? { price: l.preview?.state.close ?? l.state.close, at: l.updatedAt, live: false } : null;
}
const currentPrice = (l: LatestDoc, prices: Prices): Px => priceOf(l.symbol, [l], prices) as Px;

// Lucro/prejuizo da posicao aberta (sem taxas e funding)
function openPnl(cfg: AppConfig, symbol: string, price: number) {
  const pos = cfg.positions[symbol] ?? 0;
  const avg = cfg.avgPrice?.[symbol] ?? 0;
  if (!(pos > 0 && avg > 0)) return { usdt: 0, pct: 0, known: !(pos > 0) };
  return { usdt: pos * (price - avg), pct: (price / avg - 1) * 100, known: true };
}

// Campo numerico que aceita digitar "0," ou "0.004" antes de virar numero
function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(round8(value)));
  useEffect(() => {
    setText((t) => (Number(t.replace(",", ".")) === value ? t : String(round8(value))));
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
  const [wallet, setWallet] = useState<WalletDoc | null>(null);
  const [walletHistory, setWalletHistory] = useState<WalletHistoryDoc[]>([]);
  const [sync, setSync] = useState<LighterSyncDoc | null>(null);
  const [fichas, setFichas] = useState<FichaDoc | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [busy, setBusy] = useState(false);
  const prices = usePrices(user ? Object.keys(cfg.weights) : []);

  useEffect(() => (firebaseConfigured ? onAuthStateChanged(auth(), setUser) : setUser(null)), []);

  useEffect(() => {
    if (!user) return;
    const onErr = (e: Error) => setError(e.message.includes("permission") ? "Este e-mail nao tem acesso (veja firestore.rules)." : e.message);
    const u1 = onSnapshot(doc(db(), "config/main"), (s) => s.exists() && setCfg({ ...DEFAULT_CONFIG, ...(s.data() as AppConfig) }), onErr);
    const u2 = onSnapshot(collection(db(), "latest"), (s) => setLatest(s.docs.map((d) => d.data() as LatestDoc)), onErr);
    const u3 = onSnapshot(query(collection(db(), "trades"), orderBy("t", "desc")),
      (s) => setTrades(s.docs.map((d) => ({ id: d.id, ...(d.data() as TradeDoc) }))), onErr);
    const u4 = onSnapshot(doc(db(), "wallet/main"), (s) => setWallet(s.exists() ? (s.data() as WalletDoc) : null), onErr);
    const u5 = onSnapshot(query(collection(db(), "wallet_history"), orderBy("t"), limitToLast(365)),
      (s) => setWalletHistory(s.docs.map((d) => d.data() as WalletHistoryDoc)), onErr);
    const u6 = onSnapshot(doc(db(), "sync/lighter"), (s) => setSync(s.exists() ? (s.data() as LighterSyncDoc) : null), onErr);
    const u7 = onSnapshot(doc(db(), "fichas/main"), (s) => setFichas(s.exists() ? (s.data() as FichaDoc) : null), onErr);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, [user]);

  async function refresh() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
      if (!res.ok) {
        // A resposta pode nao ser JSON (ex.: tempo esgotado ou falha da Vercel): mostra status e texto
        const text = await res.text();
        let detail = text.slice(0, 300) || "(resposta vazia)";
        try { detail = JSON.parse(text).error ?? detail; } catch { /* nao e JSON */ }
        setError(`Recalcular falhou (HTTP ${res.status}): ${detail}`);
        return;
      }
      const body = (await res.json()) as { results?: { symbol: string; label: string }[]; projectId?: string };
      const clientProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      if (body.projectId && body.projectId !== clientProject) {
        setError(`O servidor gravou no projeto "${body.projectId}", mas o site le o projeto "${clientProject}". ` +
          "Gere a chave da conta de servico (FIREBASE_SERVICE_ACCOUNT) no mesmo projeto do Firebase.");
        return;
      }
      // Le de novo os sinais (alem do tempo real), para mostrar erro de permissao se houver
      const snap = await getDocs(collection(db(), "latest"));
      setLatest(snap.docs.map((d) => d.data() as LatestDoc));
      setNotice(`Recalculado as ${new Date().toLocaleTimeString("pt-BR")}: ` +
        (body.results ?? []).map((r) => `${r.symbol.replace("USDT", "")} ${r.label}`).join(" | ") +
        (snap.empty ? ` - mas nada foi encontrado em "latest" no projeto ${clientProject}.` : ""));
    } catch (e) {
      setError(`Recalcular falhou: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Posicao efetiva: lancamentos manuais + conta da Lighter (quando a importacao automatica esta ligada)
  const px = Object.fromEntries(SYMBOLS.map((s) => [s, priceOf(s, latest, prices)?.price ?? 0]));
  const eff = effectiveConfig(cfg, sync, wallet, px);

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
          <button className="ghost icon" onClick={() => setShowCfg(true)} aria-label="Configuracao" title="Configuracao">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button className="ghost" onClick={() => signOut(auth())}>Sair</button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {notice && <p className="muted small">{notice}</p>}
      {!latest.length && !error && <p className="muted">Nenhum sinal ainda. Clique em &quot;Recalcular agora&quot;.</p>}

      <Summary cfg={eff} latest={latest} prices={prices} sync={cfg.lighter?.enabled ? sync : null} />
      <Performance cfg={eff} latest={latest} trades={trades} prices={prices} />
      <WalletCard wallet={wallet} history={walletHistory} cfg={eff} latest={latest} user={user} />
      <FichasCard fichas={fichas} user={user} />

      <div className="grid">
        {[...latest].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((l) => (
          <AssetCard key={l.symbol} l={l} cfg={eff} prices={prices} />
        ))}
      </div>

      <TradeForm cfg={cfg} latest={latest} prices={prices} />
      {showCfg && (
        <Modal onClose={() => setShowCfg(false)}>
          <ConfigForm cfg={cfg} onClose={() => setShowCfg(false)} />
        </Modal>
      )}

      <TradesTable trades={trades} />
      <p className="muted small">Ferramenta educacional. Nao e recomendacao de investimento. O candle diario fecha as 21:00 (Brasilia).</p>
    </main>
  );
}

// Resumo do lucro: usa o preco ao vivo, entao funciona mesmo antes do primeiro "Recalcular agora"
function Summary({ cfg, latest, prices, sync }: { cfg: AppConfig; latest: LatestDoc[]; prices: Prices; sync: LighterSyncDoc | null }) {
  let open = 0;
  let invested = 0;
  let value = 0;
  let unknown = false;
  const rows: { symbol: string; pos: number; avg: number; price: number; usdt: number; pct: number }[] = [];
  for (const symbol of ordered(Object.keys(cfg.weights))) {
    const px = priceOf(symbol, latest, prices);
    const pos = cfg.positions[symbol] ?? 0;
    if (!px || !(pos > 0)) continue;
    const avg = cfg.avgPrice?.[symbol] ?? 0;
    const p = openPnl(cfg, symbol, px.price);
    open += p.usdt;
    unknown ||= !p.known;
    invested += pos * avg;
    value += pos * px.price;
    rows.push({ symbol, pos, avg, price: px.price, usdt: p.usdt, pct: p.pct });
  }
  const realized = Object.values(cfg.realized ?? {}).reduce((a, b) => a + b, 0);
  return (
    <section className="card summary">
      <div><span className="muted small">Em posicao agora</span><b>{fmt(value)} USDT</b></div>
      <div><span className="muted small">Lucro/prejuizo aberto</span>
        <b className={pnlClass(open)}>{signed(open)} USDT{invested > 0 ? ` (${signed((open / invested) * 100, 1)}%)` : ""}</b></div>
      <div><span className="muted small">Realizado (vendas)</span><b className={pnlClass(realized)}>{signed(realized)} USDT</b></div>
      <div><span className="muted small">Total</span><b className={pnlClass(open + realized)}>{signed(open + realized)} USDT</b></div>
      {rows.length > 0 && (
        <table className="full">
          <thead><tr><th>Moeda</th><th>Posicao</th><th>Preco medio</th><th>Preco atual</th><th>Lucro/prejuizo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td>{r.symbol.replace("USDT", "")}</td><td>{fmtQty(r.pos)}</td>
                <td>{r.avg > 0 ? fmtPx(r.avg) : "-"}</td><td>{fmtPx(r.price)}</td>
                <td className={pnlClass(r.usdt)}>{r.avg > 0 ? `${signed(r.usdt)} USDT (${signed(r.pct, 1)}%)` : "informe o preco medio"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unknown && <p className="warn small full">Ha posicao sem preco medio: informe-o em Configuracao para calcular o lucro.</p>}
      {sync?.shorts.length ? <p className="warn small full">Posicao vendida na Lighter ({sync.shorts.join(", ")}): fica fora da conta, a estrategia e so comprada.</p> : null}
      <p className="muted small full">
        Sem taxas e sem funding. Preco {prices.at ? `ao vivo da Binance (${ago(prices.at)})` : "do ultimo recalculo"}.
        {sync ? ` Inclui a conta da Lighter (sincronizada ${ago(sync.at)}).` : ""}
      </p>
    </section>
  );
}

// Seu resultado real x a estrategia seguida a risca, desde a primeira operacao registrada
function Performance({ cfg, latest, trades, prices }: { cfg: AppConfig; latest: LatestDoc[]; trades: TradeDoc[]; prices: Prices }) {
  if (!trades.length) return null;
  const perf = performance(cfg, latest, trades, prices.values);
  if (!perf)
    return (
      <section className="card">
        <h2>Real x estrategia</h2>
        <p className="muted small">Clique em &quot;Recalcular agora&quot; para carregar a serie da estrategia.</p>
      </section>
    );
  const last = perf.points[perf.points.length - 1];
  const diff = last.real - last.strat;
  const pctOf = (v: number) => (perf.capital > 0 ? ` (${signed((v / perf.capital) * 100, 1)}%)` : "");
  return (
    <section className="card">
      <div className="row between"><h2>Real x estrategia</h2><span className="muted small">desde {day(perf.start)}</span></div>
      <div className="summary perf">
        <div><span className="muted small">Seu resultado</span><b className={pnlClass(last.real)}>{signed(last.real)} USDT{pctOf(last.real)}</b></div>
        <div><span className="muted small">Estrategia a risca</span><b className={pnlClass(last.strat)}>{signed(last.strat)} USDT{pctOf(last.strat)}</b></div>
        <div><span className="muted small">Diferenca</span><b className={pnlClass(diff)}>{signed(diff)} USDT</b></div>
      </div>
      <PerfChart points={perf.points} />
      <p className="legend small"><i className="k-real" /> seu resultado <i className="k-strat" /> estrategia a risca</p>
      <p className="muted small">
        A estrategia usa o capital configurado de cada moeda ({fmt(perf.capital)} USDT) e opera no fechamento das 21:00.
        A diferenca mostra atraso, preco e tamanho diferentes dos sinais. Sem taxas e funding nos dois.
        {perf.clipped ? " As operacoes mais antigas que o grafico (240 dias) entram no primeiro dia." : ""}
      </p>
    </section>
  );
}

const EVENT_LABEL = { entrada: "Compra", reentrada: "Reentrada", cheia: "Posicao cheia", meia: "Reduz a metade", saida: "Venda" } as const;

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
        {d.qty > 0 && <span> {fmtQty(d.qty)} {coin} (~{fmt(d.qty * s.close)} USDT)</span>}
      </div>
      {pd && ps && (
        <p className={`preview small ${pd.kind !== d.kind ? "warn" : "muted"}`}>
          Previa (candle de hoje, aberto) a {fmtPx(ps.close)}: se fechar agora, {pd.kind !== d.kind ? <b>{pd.label}</b> : "sem mudanca"}.
          {" "}Vale so no fechamento das 21:00.
        </p>
      )}
      <div className="price-row">
        <div>
          <span className="muted small">Preco atual ({cur.live ? `ao vivo, ${ago(cur.at)}` : `recalculo ${ago(cur.at)}`})</span>
          <b>{fmtPx(cur.price)}</b>
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
        <dt>Fechamento</dt><dd>{fmtPx(s.close)}</dd>
        <dt>SMA {DEFAULT_PARAMS.sma}</dt><dd>{fmtPx(s.sma ?? 0)} ({fmt(((s.close / (s.sma ?? s.close)) - 1) * 100, 1)}%)</dd>
        <dt>Compra acima / sai abaixo</dt><dd>{fmtPx((s.sma ?? 0) * (1 + buf))} / {fmtPx((s.sma ?? 0) * (1 - buf))}</dd>
        <dt>HMA {DEFAULT_PARAMS.hma}</dt><dd className={s.hmaDown ? "warn" : ""}>{s.hmaDown ? "CAINDO" : "subindo"}{s.turnDown ? " (virou hoje)" : ""}</dd>
        <dt>Volatilidade 30d</dt><dd>{fmt((s.vol ?? 0) * 100, 0)}% ao ano</dd>
        <dt>Exposicao alvo</dt><dd>{fmt(s.expo)}x = {fmtQty(d.targetQty)} {coin}</dd>
        <dt>Sua posicao</dt><dd>{fmtQty(pos)} {coin}{pos > 0 && avg > 0 ? ` a ${fmtPx(avg)}` : ""}</dd>
        {realized !== 0 && <><dt>Realizado</dt><dd className={pnlClass(realized)}>{signed(realized)} USDT</dd></>}
        {s.stop !== null && <><dt>Stop da reentrada</dt><dd>{fmtPx(s.stop)}</dd></>}
      </dl>
      {l.events?.length ? (
        <details className="history">
          <summary className="small">Historico de sinais ({l.events.length})</summary>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Data</th><th>Sinal</th><th>Preco</th><th>Motivo</th><th>Trade</th></tr></thead>
              <tbody>
                {[...l.events].reverse().map((e) => (
                  <tr key={e.t}>
                    <td>{day(e.t)}</td>
                    <td className={e.kind === "saida" || e.kind === "meia" ? "neg" : "pos"}>{EVENT_LABEL[e.kind]}</td>
                    <td>{fmtPx(e.price)}</td>
                    <td className="muted">{e.reason}</td>
                    <td className={e.ret === null ? "" : pnlClass(e.ret)}>{e.ret === null ? "" : `${signed(e.ret * 100, 1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Trade = variacao do preco da entrada ate a saida (sem o tamanho da posicao).</p>
        </details>
      ) : (
        <p className="muted small">Ultimos sinais: {l.changes.map((c) => `${day(c.t)} ${c.on ? "compra" : "saida"}`).join(", ") || "-"}</p>
      )}
    </section>
  );
}

function TradeForm({ cfg, latest, prices }: { cfg: AppConfig; latest: LatestDoc[]; prices: Prices }) {
  const symbols = ordered(Object.keys(cfg.weights));
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
    const { pos: next, avg: nextAvg, realized } = applyTrade(
      { pos: cfg.positions[symbol] ?? 0, avg: cfg.avgPrice?.[symbol] ?? 0, realized: cfg.realized?.[symbol] ?? 0 }, side, q, p);
    await addDoc(collection(db(), "trades"), { symbol, side, qty: q, price: p, t: Date.now() } satisfies TradeDoc);
    await setDoc(doc(db(), "config/main"),
      { positions: { [symbol]: round8(next) }, avgPrice: { [symbol]: round8(nextAvg) }, realized: { [symbol]: round8(realized) } },
      { merge: true });
    setQty("");
    setPrice("");
    setMsg(`Registrado. Posicao em ${symbol}: ${fmtQty(next)}${next > 0 ? ` a preco medio ${fmtPx(nextAvg)}` : ""}.`);
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

// Janela sobreposta: fecha no X, no Esc ou clicando fora
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

function ConfigForm({ cfg, onClose }: { cfg: AppConfig; onClose: () => void }) {
  const [draft, setDraft] = useState(cfg);
  useEffect(() => setDraft(cfg), [cfg]);

  const [err, setErr] = useState("");
  const [watchText, setWatchText] = useState((cfg.watchlist ?? []).join(", "));
  const [walletText, setWalletText] = useState((cfg.wallets?.length ? cfg.wallets : cfg.wallet ? [cfg.wallet] : []).join("\n"));
  async function save() {
    const clean = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round8(v)]));
    const wallets = [...new Set(walletText.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean))];
    const bad = wallets.filter((a) => !isEvmAddress(a) && !isSolAddress(a));
    if (bad.length) return setErr(`Endereco invalido: ${bad.join(", ")} (EVM = 0x + 40 caracteres; Solana = 32 a 44 caracteres).`);
    if (draft.lighter?.enabled && !wallets.some(isEvmAddress)) return setErr("Para importar da Lighter, informe um endereco EVM (0x...).");
    const wallet = wallets.find(isEvmAddress) ?? "";
    await setDoc(doc(db(), "config/main"), {
      ...draft, wallet, wallets,
      watchlist: [...new Set(watchText.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9]{2,12}$/.test(t)))],
      weights: clean(draft.weights), positions: clean(draft.positions), avgPrice: clean(draft.avgPrice), realized: clean(draft.realized),
    });
    onClose();
  }

  const symbols = ordered(Object.keys(draft.weights));
  const totalWeight = Object.values(draft.weights).reduce((a, b) => a + b, 0);
  const setMap = (key: "weights" | "positions" | "avgPrice", s: string, v: number) =>
    setDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [s]: v } });

  return (
    <section>
      <div className="row between modal-head">
        <h2>Configuracao</h2>
        <button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button>
      </div>
      <div className="cfg-top">
        <label>Capital total (USDT) <NumInput value={draft.capitalUsdt} onChange={(v) => setDraft({ ...draft, capitalUsdt: v })} /></label>
        <label className="check">
          <input type="checkbox" checked={draft.reentry} onChange={(e) => setDraft({ ...draft, reentry: e.target.checked })} />
          Reentrada no repique (meia posicao)
        </label>
        <label className="check">
          <input type="checkbox" checked={!!draft.lighter?.enabled}
            onChange={(e) => setDraft({ ...draft, lighter: { enabled: e.target.checked, since: draft.lighter?.since ?? Date.now() - 30 * 86_400_000 } })} />
          Importar da Lighter automaticamente
        </label>
        {draft.lighter?.enabled && (
          <label>Operacoes a partir de
            <input type="date" value={new Date(draft.lighter.since).toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && setDraft({ ...draft, lighter: { enabled: true, since: Date.parse(`${e.target.value}T00:00:00Z`) } })} />
          </label>
        )}
        <label className="grow">Carteiras on-chain (enderecos publicos, um por linha: EVM 0x... e/ou Solana)
          <textarea rows={3} value={walletText} placeholder={"0x... (Rabby)\n7xKX... (Phantom Solana)"} spellCheck={false}
            onChange={(e) => setWalletText(e.target.value)} />
        </label>
        <label className="grow">Tokens extras nas fichas (simbolos separados por virgula, ex.: HYPE, PENDLE, JUP)
          <input value={watchText} placeholder="HYPE, PENDLE" spellCheck={false} onChange={(e) => setWatchText(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={!!draft.walletPositions} onChange={(e) => setDraft({ ...draft, walletPositions: e.target.checked })} />
          Posicao da estrategia = saldo das carteiras (no lugar das posicoes manuais)
        </label>
      </div>
      <div className="table-scroll">
        <table className="cfg-table">
          <thead>
            <tr><th>Moeda</th><th>Peso (%)</th><th>Capital alocado</th><th>Posicao manual (moedas)</th><th>Preco medio (USDT)</th></tr>
          </thead>
          <tbody>
            {symbols.map((s) => (
              <tr key={s}>
                <td><b>{s.replace("USDT", "")}</b></td>
                <td><NumInput value={round8(draft.weights[s] * 100)} onChange={(v) => setMap("weights", s, v / 100)} /></td>
                <td className="muted">{fmt(draft.capitalUsdt * draft.weights[s])} USDT</td>
                <td><NumInput value={draft.positions[s] ?? 0} onChange={(v) => setMap("positions", s, v)} /></td>
                <td><NumInput value={draft.avgPrice?.[s] ?? 0} onChange={(v) => setMap("avgPrice", s, v)} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className={Math.abs(totalWeight - 1) > 0.011 ? "warn" : ""}>{fmt(totalWeight * 100, 0)}%</td>
              <td className="muted">{fmt(draft.capitalUsdt * totalWeight)} USDT</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="row cfg-actions">
        <button onClick={save}>Salvar</button>
        <button className="ghost" onClick={onClose}>Cancelar</button>
      </div>
      {err && <p className="error small">{err}</p>}
      {Math.abs(totalWeight - 1) > 0.011 && (
        <p className="warn small">Os pesos somam {fmt(totalWeight * 100, 0)}%: o normal e 100% do capital.</p>
      )}
      <p className="muted small">
        Posicao e preco medio manuais sao atualizados sozinhos ao registrar operacoes; edite aqui so para corrigir.
        Com a Lighter ligada, a posicao de la e somada automaticamente (o agendador sincroniza a cada 15 min).
        Com a posicao das carteiras ligada, o saldo a vista de BTC, ETH e SOL nas carteiras (cbBTC, WETH, stETH, JitoSOL...)
        vira a posicao da estrategia; o preco medio continua o desta tabela (informe-o para ver o lucro).
        A reentrada muda o calculo do servidor: depois de alterar, clique em &quot;Recalcular agora&quot;.
      </p>
    </section>
  );
}

const PAGE_SIZE = 10;

// Historico de operacoes: busca livre, filtro por moeda e lado, 10 por pagina
type TradeRow = TradeDoc & { id: string };

// Grava a mudanca na operacao e refaz posicao, preco medio e realizado das moedas afetadas a partir do historico
async function saveTradeChange(all: TradeRow[], change: { id: string; next: TradeDoc | null }) {
  const old = all.find((t) => t.id === change.id);
  const after = all.filter((t) => t.id !== change.id).concat(change.next ? [{ ...change.next, id: change.id }] : []);
  const symbols = [...new Set([old?.symbol, change.next?.symbol].filter((s): s is string => !!s))];
  const batch = writeBatch(db());
  const ref = doc(db(), "trades", change.id);
  if (change.next) batch.set(ref, change.next);
  else batch.delete(ref);
  const books = Object.fromEntries(symbols.map((s) => [s, rebuild(after, s)]));
  batch.set(doc(db(), "config/main"), {
    positions: Object.fromEntries(symbols.map((s) => [s, books[s].pos])),
    avgPrice: Object.fromEntries(symbols.map((s) => [s, books[s].avg])),
    realized: Object.fromEntries(symbols.map((s) => [s, books[s].realized])),
  }, { merge: true });
  await batch.commit();
  return books;
}

const toLocalInput = (t: number) => {
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const RECALC_NOTE = "A posicao, o preco medio e o realizado da moeda serao refeitos a partir de TODAS as operacoes registradas dela " +
  "(ajustes feitos a mao na Configuracao serao substituidos).";

type Editing = { id: string; symbol: string; side: TradeDoc["side"]; qty: string; price: string; when: string };

function TradesTable({ trades }: { trades: TradeRow[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [coin, setCoin] = useState("");
  const [side, setSide] = useState("");
  const [page, setPage] = useState(0);
  const coins = ordered([...new Set(trades.map((t) => t.symbol))]);
  const q = search.trim().toLowerCase();
  const rows = trades.filter((t) => {
    if (coin && t.symbol !== coin) return false;
    if (side && t.side !== side) return false;
    if (!q) return true;
    const text = [new Date(t.t).toLocaleString("pt-BR"), t.symbol, t.side, fmtQty(t.qty), fmtPx(t.price), String(t.qty), String(t.price), t.source ?? "manual", t.note ?? ""]
      .join(" ").toLowerCase();
    return text.includes(q);
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => setPage(0), [search, coin, side]);

  const summary = (books: Record<string, { pos: number; avg: number }>) =>
    Object.entries(books).map(([s, b]) => `${s.replace("USDT", "")}: ${fmtQty(b.pos)}${b.pos > 0 ? ` a ${fmtPx(b.avg)}` : ""}`).join(" | ");

  async function saveEdit() {
    if (!editing) return;
    const q = Number(editing.qty.replace(",", "."));
    const p = Number(editing.price.replace(",", "."));
    const t = new Date(editing.when).getTime();
    if (!(q > 0) || !(p > 0) || !Number.isFinite(t)) return setMsg("Quantidade, preco e data precisam ser validos.");
    if (!window.confirm(`Salvar a alteracao?\n\n${RECALC_NOTE}`)) return;
    try {
      const books = await saveTradeChange(trades, {
        id: editing.id, next: { symbol: editing.symbol, side: editing.side, qty: round8(q), price: round8(p), t },
      });
      setEditing(null);
      setMsg(`Operacao alterada. Posicao agora: ${summary(books)}.`);
    } catch (e) {
      setMsg(`Nao foi possivel salvar: ${String(e)}`);
    }
  }

  async function remove(t: TradeRow) {
    const what = `${t.side} de ${fmtQty(t.qty)} ${t.symbol.replace("USDT", "")} a ${fmtPx(t.price)} em ${new Date(t.t).toLocaleString("pt-BR")}`;
    if (!window.confirm(`Excluir a ${what}?\n\n${RECALC_NOTE}`)) return;
    try {
      const books = await saveTradeChange(trades, { id: t.id, next: null });
      setMsg(`Operacao excluida. Posicao agora: ${summary(books)}.`);
    } catch (e) {
      setMsg(`Nao foi possivel excluir: ${String(e)}`);
    }
  }

  return (
    <section className="card">
      <div className="row between wrap-row trades-head">
        <h2>Operacoes registradas</h2>
        <div className="row wrap-row">
          <input type="search" placeholder="Buscar (data, moeda, preco...)" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={coin} onChange={(e) => setCoin(e.target.value)} aria-label="Moeda">
            <option value="">Todas as moedas</option>
            {coins.map((c) => <option key={c} value={c}>{c.replace("USDT", "")}</option>)}
          </select>
          <select value={side} onChange={(e) => setSide(e.target.value)} aria-label="Lado">
            <option value="">Compra e venda</option>
            <option value="compra">compra</option>
            <option value="venda">venda</option>
          </select>
        </div>
      </div>
      {!trades.length ? (
        <p className="muted">Nenhuma ainda.</p>
      ) : !rows.length ? (
        <p className="muted">Nenhuma operacao encontrada com esses filtros.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Data</th><th>Moeda</th><th>Lado</th><th>Qtd</th><th>Preco</th><th>Valor (USDT)</th><th /></tr></thead>
              <tbody>
                {shown.map((t) => editing?.id === t.id ? (
                  <tr key={t.id} className="editing">
                    <td><input type="datetime-local" value={editing.when} onChange={(e) => setEditing({ ...editing, when: e.target.value })} /></td>
                    <td>
                      <select value={editing.symbol} onChange={(e) => setEditing({ ...editing, symbol: e.target.value })}>
                        {ordered([...new Set([...SYMBOLS, editing.symbol])]).map((c) => <option key={c} value={c}>{c.replace("USDT", "")}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={editing.side} onChange={(e) => setEditing({ ...editing, side: e.target.value as TradeDoc["side"] })}>
                        <option value="compra">compra</option><option value="venda">venda</option>
                      </select>
                    </td>
                    <td><input value={editing.qty} inputMode="decimal" onChange={(e) => setEditing({ ...editing, qty: e.target.value })} /></td>
                    <td><input value={editing.price} inputMode="decimal" onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></td>
                    <td className="muted">{fmt((Number(editing.qty.replace(",", ".")) || 0) * (Number(editing.price.replace(",", ".")) || 0))}</td>
                    <td className="actions">
                      <button className="icon" onClick={saveEdit} title="Salvar" aria-label="Salvar">&#x2713;</button>
                      <button className="ghost icon" onClick={() => setEditing(null)} title="Cancelar" aria-label="Cancelar">&#x2715;</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id}>
                    <td>{new Date(t.t).toLocaleString("pt-BR")}</td>
                    <td>{t.symbol.replace("USDT", "")}{t.source === "lighter" && <span className="tag">Lighter</span>}</td>
                    <td className={t.side === "compra" ? "pos" : "neg"}>{t.side}{t.note ? ` (${t.note})` : ""}</td>
                    <td>{fmtQty(t.qty)}</td>
                    <td>{fmtPx(t.price)}</td>
                    <td>{fmt(t.qty * t.price)}</td>
                    <td className="actions">{t.source === "lighter" ? <span className="muted small" title="Importada da Lighter: edite la">auto</span> : <>
                      <button className="ghost icon" title="Editar" aria-label="Editar"
                        onClick={() => setEditing({ id: t.id, symbol: t.symbol, side: t.side, qty: String(t.qty), price: String(t.price), when: toLocalInput(t.t) })}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      </button>
                      <button className="ghost icon danger" title="Excluir" aria-label="Excluir" onClick={() => remove(t)}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {msg && <p className="muted small">{msg}</p>}
          <div className="row between pager">
            <span className="muted small">
              {rows.length} operac{rows.length === 1 ? "ao" : "oes"}{rows.length !== trades.length ? ` (de ${trades.length})` : ""}
            </span>
            <div className="row">
              <button className="ghost" onClick={() => setPage(cur - 1)} disabled={cur === 0}>Anterior</button>
              <span className="small">Pagina {cur + 1} de {pages}</span>
              <button className="ghost" onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1}>Proxima</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
