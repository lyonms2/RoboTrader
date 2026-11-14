"use client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, limitToLast, onSnapshot, orderBy, query, setDoc, where, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { auth, db, firebaseConfigured } from "@/lib/firebaseClient";
import { P, memberBase, setDataBase, setReadOnly } from "@/lib/paths";
import { applyTrade, rebuild } from "@/lib/ledger";
import { performance } from "@/lib/performance";
import { DEFAULT_ALLOC, allocOf, effectiveConfig } from "@/lib/positions";
import { allocationBlocks, walletNotices } from "@/lib/allocation";
import { isEvmAddress, isSolAddress, walletAddresses, walletKey } from "@/lib/addresses";
import { DEFAULT_PARAMS, decide } from "@/lib/strategy";
import { health, referenceOf } from "@/lib/robotStats";
import { DEFAULT_CONFIG, SYMBOLS, type AppConfig, type LatestDoc, type FichaDoc, type LighterSyncDoc, type FinanceDoc, type TradeDoc, type WalletDoc, type WalletHistoryDoc } from "@/lib/types";
import Chart from "./Chart";
import PerfChart from "./PerfChart";
const SHOW_CANDIDATES = false;
import dynamic from "next/dynamic";
import { MonthAndUpcoming, NetWorthBlock, PatrimonioCard } from "./OverviewBlocks";
import type { Sub as FinSub } from "./FinanceCard";
import { reviewCount, saveSetup, upcoming, budgetAlerts } from "./gastosShared";
// Abas que carregam so quando abertas (a Visao geral abre sem baixar o codigo delas)
const loadingTab = () => <p className="muted">Carregando...</p>;
const FinanceCard = dynamic(() => import("./FinanceCard"), { loading: loadingTab });
const WalletCard = dynamic(() => import("./WalletCard"), { loading: loadingTab });
const FichasCard = dynamic(() => import("./FichasCard"), { loading: loadingTab });
const CandidatesCard = dynamic(() => import("./CandidatesCard"), { loading: loadingTab });
const Manual = dynamic(() => import("./Manual"), { loading: loadingTab });
import { buildAlerts } from "@/lib/alerts";
import type { NetWorthDoc } from "@/lib/patrimonio";
import { EMPTY_SETUP, debts, monthIncomes, setCardsReg, accountBalance, avgMonthly, fixoActive, recvStatus, fixoReajPending, investFlows, setCustomCats, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import { financeSummary } from "@/lib/financeMath";
import type { CandidatesDoc } from "@/lib/candidates";
import { usePrices, type Prices } from "./usePrices";
import { ask, askText, tell } from "./Dialog";

import Note from "./Note";
import ExportData from "./ExportData";
import ScrollHints from "./ScrollHints";
const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// Sem arredondar: quantidades com ate 8 casas (precisao da corretora) e precos com 2 a 8 casas
const fmtQty = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const fmtPx = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
const day = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "agora" : `há ${m} min`;
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

// Dados de exemplo para conferir o visual sem login (so usado em paginas de teste locais)
export type Demo = {
  cfg: AppConfig; latest: LatestDoc[]; trades: (TradeDoc & { id: string })[]; wallet: WalletDoc | null;
  walletHistory: WalletHistoryDoc[]; fichas: FichaDoc | null; candidates?: CandidatesDoc | null; finance?: FinanceDoc | null;
  months?: Record<string, MonthDoc>; setup?: GastosSetup; nwHist?: NetWorthDoc[];
  member?: boolean; // demo vista como membro
  robo?: boolean; // demo de membro com "Robo e tokens"
};

export default function Dashboard({ demo }: { demo?: Demo }) {
  const [user, setUser] = useState<User | null | undefined>(demo ? ({} as User) : undefined);
  const [cfg, setCfg] = useState<AppConfig>(demo?.cfg ?? DEFAULT_CONFIG);
  const [latest, setLatest] = useState<LatestDoc[]>(demo?.latest ?? []);
  const [trades, setTrades] = useState<(TradeDoc & { id: string })[]>(demo?.trades ?? []);
  const [wallet, setWallet] = useState<WalletDoc | null>(demo?.wallet ?? null);
  const [walletHistory, setWalletHistory] = useState<WalletHistoryDoc[]>(demo?.walletHistory ?? []);
  const [sync, setSync] = useState<LighterSyncDoc | null>(null);
  const [fichas, setFichas] = useState<FichaDoc | null>(demo?.fichas ?? null);
  const [candidates, setCandidates] = useState<CandidatesDoc | null>(demo?.candidates ?? null);
  const [finance, setFinance] = useState<FinanceDoc | null>(demo?.finance ?? null);
  const [nwHist, setNwHist] = useState<NetWorthDoc[]>(demo?.nwHist ?? []);
  const [months, setMonths] = useState<Record<string, MonthDoc>>(demo?.months ?? {});
  const [gSetup, setGSetup] = useState<GastosSetup>(demo?.setup ?? EMPTY_SETUP);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  // Modo suporte: o dono le a conta de um membro que autorizou (so leitura)
  const [support, setSupport] = useState<{ uid: string; email: string; until: number } | null>(null);
  const clearData = () => { setCfg(DEFAULT_CONFIG); setWallet(null); setWalletHistory([]); setFinance(null); setMonths({}); setGSetup(EMPTY_SETUP); setNwHist([]); setTrades([]); setSync(null); setFichas(null); setCandidates(null); };
  const enterSupport = (x: { uid: string; email: string; until: number }) => { clearData(); setDataBase(memberBase(x.uid)); setReadOnly(true); setSupport(x); setShowAdmin(false); setTabState("geral"); };
  const exitSupport = () => { clearData(); setDataBase(""); setReadOnly(false); setSupport(null); };
  const [showAccount, setShowAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  // Aba aberta, lembrada neste navegador
  const [tab, setTabState] = useState<TabId>("geral");
  useEffect(() => {
    try {
      const t = localStorage.getItem("tab");
      // "gastos" virou sub-aba de Financas
      if (t === "gastos") setTabState("financas");
      else if (t) setTabState(t as TabId);
    } catch { /* sem armazenamento */ }
  }, []);
  const setTab = (t: TabId) => {
    setTabState(t);
    try {
      localStorage.setItem("tab", t);
      if (CRYPTO_TABS.includes(t)) localStorage.setItem("criptoSub", t);
    } catch { /* sem armazenamento */ }
    window.scrollTo({ top: 0 });
  };
  const prices = usePrices(user ? Object.keys(cfg.weights) : []);

  useEffect(() => (demo ? undefined : firebaseConfigured ? onAuthStateChanged(auth(), setUser) : setUser(null)), [demo]);
  // Quem entrou: dono (le a raiz, como sempre), membro (access/{email} -> users/{uid}/) ou sem acesso
  const [role, setRole] = useState<"owner" | "member" | "none" | null>(demo ? (demo.member ? "member" : "owner") : null);
  // nivel do membro: com "Robo e tokens" (padrao) ou sem
  const [robo, setRobo] = useState(demo ? demo.robo !== false : true);
  useEffect(() => {
    if (demo || !user) return;
    let alive = true;
    (async () => {
      const email = (user.email ?? "").toLowerCase();
      try {
        const a = await getDoc(doc(db(), "access", email));
        if (a.exists() && (a.data() as { role?: string }).role === "member") {
          setDataBase(memberBase(user.uid));
          if (alive) { setRobo((a.data() as { robo?: boolean }).robo !== false); setRole("member"); }
          return;
        }
      } catch { /* sem regra de acesso ainda: segue para o teste de dono */ }
      try {
        await getDoc(doc(db(), "config/main"));
        setDataBase("");
        if (alive) setRole("owner");
      } catch {
        if (alive) setRole("none");
      }
    })();
    return () => { alive = false; };
  }, [user, demo]);
  const member = role === "member" || !!support;
  // acesso ao Robo e tokens: dono sempre; membro conforme o nivel (no suporte, o dono ve como o membro ve o resto)
  const canRobo = !member || !!support || robo;
  // a autorizacao expira sozinha
  useEffect(() => {
    if (!support) return;
    const id = setTimeout(exitSupport, Math.max(0, support.until - Date.now()));
    return () => clearTimeout(id);
  }, [support]);
  // altura do topo (muda no celular): as sub-abas ficam ancoradas logo abaixo dele
  useEffect(() => {
    const h = document.querySelector("header.topbar");
    if (!h) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${Math.round(h.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(h);
    return () => ro.disconnect();
  }, [user, role]);
  // Tokens agora fica junto do Robo; membro nao tem Operacoes manuais: cai no Robo (estudo)
  useEffect(() => {
    if (tab === "tokens" || (member && tab === "operacoes")) setTabState(canRobo ? "sinais" : "carteira");
    else if (tab === "sinais" && !canRobo) setTabState("carteira");
  }, [member, tab, canRobo]);

  useEffect(() => {
    if (!user || demo || (role !== "owner" && role !== "member")) return;
    const onErr = (e: Error) => setError(e.message.includes("permission") ? "Este e-mail não tem acesso (veja firestore.rules)." : e.message);
    const owner = role === "owner" && !support;
    const none = () => undefined;
    const u1 = onSnapshot(doc(db(), P("config/main")), (s) => s.exists() && setCfg({ ...DEFAULT_CONFIG, ...(s.data() as AppConfig) }), onErr);
    const u2 = !owner && !robo ? none : onSnapshot(collection(db(), "latest"), (s) => setLatest(s.docs.map((d) => d.data() as LatestDoc)), onErr);
    const u3 = !owner ? none : onSnapshot(query(collection(db(), "trades"), orderBy("t", "desc")),
      (s) => setTrades(s.docs.map((d) => ({ id: d.id, ...(d.data() as TradeDoc) }))), onErr);
    const u4 = onSnapshot(doc(db(), P("wallet/main")), (s) => setWallet(s.exists() ? (s.data() as WalletDoc) : null), onErr);
    // historicos: um documento por mes (dias dentro); enquanto o servidor nao gravou no formato novo, le os dias
    const monthly = <T extends { t: number }>(col: string, months: number, days: number, set: (v: T[]) => void) => {
      let old: (() => void) | null = null;
      // meses a partir de um corte (filtro pelo nome do documento, AAAA-MM: nao precisa de indice extra no Firebase)
      const d0 = new Date(Date.now() - 3 * 3_600_000);
      d0.setUTCDate(1); d0.setUTCMonth(d0.getUTCMonth() - (months - 1));
      const un = onSnapshot(query(collection(db(), P(`${col}_m`)), where(documentId(), ">=", d0.toISOString().slice(0, 7))), (s) => {
        if (s.empty) {
          if (!old) old = onSnapshot(query(collection(db(), P(col)), orderBy("t"), limitToLast(days)), (x) => set(x.docs.map((d) => d.data() as T)), onErr);
          return;
        }
        if (old) { old(); old = null; }
        set(s.docs.flatMap((d) => Object.values((d.data() as { days?: Record<string, T> }).days ?? {})).sort((a, b) => a.t - b.t));
      }, onErr);
      return () => { un(); if (old) old(); };
    };
    const u5 = monthly<WalletHistoryDoc>("wallet_history", 13, 365, setWalletHistory);
    const u6 = !owner ? none : onSnapshot(doc(db(), "sync/lighter"), (s) => setSync(s.exists() ? (s.data() as LighterSyncDoc) : null), onErr);
    // membro com Robo e tokens le a copia publica (sem a carteira do dono)
    const u7 = owner || robo ? onSnapshot(doc(db(), owner ? "fichas/main" : "fichas_pub/main"), (s) => setFichas(s.exists() ? (s.data() as FichaDoc) : null), () => setFichas(null)) : none;
    const u8 = !owner ? none : onSnapshot(doc(db(), "candidates/main"), (s) => setCandidates(s.exists() ? (s.data() as CandidatesDoc) : null), onErr);
    const u9 = onSnapshot(doc(db(), P("finance/main")), (s) => setFinance(s.exists() ? (s.data() as FinanceDoc) : null), onErr);
    // Gastos: config/gastos-AAAA-MM (um por mes) e config/gastos-setup
    const u10 = onSnapshot(query(collection(db(), P("config")), where(documentId(), ">=", "gastos-"), where(documentId(), "<", "gastos-\uf8ff")), (s) => {
      const ms: Record<string, MonthDoc> = {};
      let st: GastosSetup = EMPTY_SETUP;
      for (const d of s.docs) {
        if (d.id === "gastos-setup") st = { ...EMPTY_SETUP, ...(d.data() as GastosSetup) };
        else ms[d.id.slice(7)] = { items: (d.data() as MonthDoc).items ?? [] };
      }
      setMonths(ms);
      setGSetup(st);
    }, onErr);
    const u11 = monthly<NetWorthDoc>("patrimonio_history", 60, 1500, setNwHist);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); u9(); u10(); u11(); };
  }, [user, demo, role, support, robo]);

  // Financas (cotacoes, CDI, Tesouro) numa chamada separada: o arquivo do Tesouro e grande e nao pode atrasar os sinais
  async function refreshFinance() {
    try {
      const res = await fetch("/api/finance", { method: "POST", headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
      const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] };
      if (!res.ok) return [`finanças: ${body.error ?? `HTTP ${res.status}`}`];
      return (body.errors ?? []).map((e) => `finanças: ${e}`);
    } catch (e) {
      return [`finanças: ${String(e)}`];
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    setNotice("");
    const finJob = refreshFinance();
    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
      if (!res.ok) {
        // A resposta pode nao ser JSON (ex.: tempo esgotado ou falha da Vercel): mostra status e texto
        const text = await res.text();
        let detail = text.slice(0, 300) || "(resposta vazia)";
        try { detail = JSON.parse(text).error ?? detail; } catch { /* nao e JSON */ }
        setError(`Atualizar falhou (HTTP ${res.status}): ${detail}`);
        return;
      }
      const body = (await res.json()) as {
        results?: { symbol: string; label: string }[]; projectId?: string;
        wallet?: { error?: string; errors?: string[]; reason?: string; total?: number } | null;
        fichas?: { error?: string; errors?: string[]; count?: number } | null;
      };
      const clientProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      if (body.projectId && body.projectId !== clientProject) {
        setError(`O servidor gravou no projeto "${body.projectId}", mas o site le o projeto "${clientProject}". ` +
          "Gere a chave da conta de serviço (FIREBASE_SERVICE_ACCOUNT) no mesmo projeto do Firebase.");
        return;
      }
      // Membro: o servidor so le a carteira dele e as cotacoes
      if (member) {
        const b = body as { wallet?: { error?: string; errors?: string[]; reason?: string; total?: number } | null };
        const finProblems = await finJob;
        const probs = [...finProblems, b.wallet?.error, ...(b.wallet?.errors ?? [])].filter(Boolean);
        setNotice(`Atualizado às ${new Date().toLocaleTimeString("pt-BR")}` + (b.wallet?.total !== undefined ? `: carteira $${fmt(b.wallet.total)}` : b.wallet?.reason ? ` (carteira: ${b.wallet.reason})` : "") +
          (probs.length ? `. Avisos: ${probs.join("; ")}` : "."));
        return;
      }
      // Le de novo os sinais (alem do tempo real), para mostrar erro de permissao se houver
      const snap = await getDocs(collection(db(), "latest"));
      setLatest(snap.docs.map((d) => d.data() as LatestDoc));
      const finProblems = await finJob;
      const problems = [
        ...finProblems, body.wallet?.error, ...(body.wallet?.errors ?? []), body.fichas?.error, ...(body.fichas?.errors ?? []),
        snap.empty ? `nada foi encontrado em "latest" no projeto ${clientProject}` : undefined,
      ].filter(Boolean);
      setNotice(`Atualizado às ${new Date().toLocaleTimeString("pt-BR")}: sinais` +
        (body.wallet?.total !== undefined ? `, carteiras ($${fmt(body.wallet.total)})` : body.wallet?.reason ? ` (carteiras: ${body.wallet.reason})` : "") +
        (body.fichas?.count !== undefined ? `, ${body.fichas.count} fichas` : "") + ", finanças." +
        (problems.length ? ` Avisos: ${problems.join("; ")}` : ""));
    } catch (e) {
      setError(`Atualizar falhou: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Posicao efetiva: lancamentos manuais + conta da Lighter (quando a importacao automatica esta ligada)
  const px = Object.fromEntries(SYMBOLS.map((s) => [s, priceOf(s, latest, prices)?.price ?? 0]));
  const eff = effectiveConfig(cfg, sync, wallet, px);
  const walletOk = !!wallet && wallet.address === walletKey(walletAddresses(cfg));
  // calculos de financas so quando os dados mudam (o preco do cripto atualiza a tela a cada 30 s)
  const spend = useMemo(() => avgMonthly(months), [months, gSetup]);
  setCustomCats(gSetup.customCats);
  setCardsReg(gSetup.cards); // categorias criadas por voce (usadas nos menus e nos totais)
  const debt = useMemo(() => debts(months, gSetup), [months, gSetup]);

  if (!firebaseConfigured && !demo)
    return <main className="wrap center"><h1>SeuBitico</h1><p className="error">Firebase não configurado: cadastre as variáveis NEXT_PUBLIC_FIREBASE_* na Vercel e faça Redeploy.</p></main>;
  if (user === undefined || (user && role === null)) return <main className="wrap"><p>Carregando...</p></main>;
  if (!user)
    return (
      <main className="wrap login">
        <img className="brand-mark" src="/seubitico-256.png" alt="SeuBitico" width={96} height={96} />
        <h1 className="brand-name">Seu<span className="bb">Bitico</span></h1>
        <p className="muted">Finanças pessoais e cripto num lugar só: contas, cartões, investimentos e carteira.</p>
        <button onClick={() => signInWithPopup(auth(), new GoogleAuthProvider())}>Entrar com Google</button>
        <p className="muted small">Ferramenta educacional, não é recomendação de investimento.</p>
      </main>
    );
  if (role === "none")
    return (
      <main className="wrap login">
        <img className="brand-mark" src="/seubitico-256.png" alt="SeuBitico" width={96} height={96} />
        <h1 className="brand-name">Seu<span className="bb">Bitico</span></h1>
        <p>O e-mail <b>{user.email}</b> ainda não tem acesso.</p>
        <p className="muted small">A área é para membros do canal. Se você é membro, envie este e-mail para o SeuBitico liberar o acesso.</p>
        <button className="ghost" onClick={() => signOut(auth())}>Sair</button>
      </main>
    );

  // Topo: Visao geral, Financas e Cripto; dentro de Cripto: Robo, Carteira, Tokens e Operacoes
  const tabs = [
    { id: "geral", label: "Visão geral" },
    { id: "financas", label: "Finanças" },
    { id: "cripto", label: "Cripto" },
    { id: "ajuda", label: "Ajuda" },
  ] as const;
  const cryptoSubs = [
    { id: "carteira", label: "Carteira" },
    { id: "sinais", label: "Robô e tokens" },
    { id: "operacoes", label: "Operações manuais" },
  ] as const;
  const inCrypto = CRYPTO_TABS.includes(tab);
  const lastCrypto = (): TabId => {
    try {
      const v = localStorage.getItem("criptoSub") as TabId | null;
      return v && CRYPTO_TABS.includes(v) && v !== "tokens" ? v : "carteira";
    } catch {
      return "carteira";
    }
  };
  const updatedAt = Math.max(0, ...latest.map((l) => l.updatedAt), wallet?.at ?? 0, fichas?.at ?? 0);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-row">
            <img className="brand-mark" src="/seubitico-96.png" alt="" width={34} height={34} />
            <div className="brand">
              <span className="brand-name">Seu<span className="bb">Bitico</span></span>
              <span className="muted small">finanças e cripto{updatedAt ? ` - dados ${ago(updatedAt)}` : ""}</span>
            </div>
          </div>
          <div className="row">
            {role === "owner" && !demo && !support && <button className="ghost" onClick={() => setShowAdmin(true)}>Membros</button>}
            {member && !support && <button className="ghost" onClick={() => setShowAccount(true)}>Minha conta</button>}
            <button className="ghost" onClick={() => signOut(auth())}>Sair</button>
          </div>
        </div>
        <ScrollHints />
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === "cripto" ? inCrypto : tab === t.id}
              className={(t.id === "cripto" ? inCrypto : tab === t.id) ? "tab active" : "tab"} onClick={() => setTab(t.id === "cripto" ? lastCrypto() : t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="wrap">
        {support && <p className="banner support-bar"><b>Modo suporte:</b> vendo a conta de {support.email}, só leitura, até {new Date(support.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.
          <button className="primary small-btn" onClick={exitSupport}>Sair do suporte</button></p>}
        {error && <p className="banner error">{error}</p>}
        {notice && <p className="banner">{notice}</p>}

        {tab === "geral" && (
          <Overview member={member} cfg={eff} latest={latest} prices={prices} wallet={wallet} fichas={fichas} sync={cfg.lighter?.enabled ? sync : null} onTab={setTab}
            money={{ cfg, fin: finance, wallet: walletOk ? wallet : null, spend, debt, months, setup: gSetup, nwHist }}
            onFin={(s: FinSub | "loans" | "recv") => { try { localStorage.setItem("finSub", s); } catch { /* sem armazenamento */ } setTab("financas"); }} />
        )}
        {inCrypto && (
          <div className="toolbar">
            <nav className="subtabs" role="tablist" aria-label="Cripto">
              {cryptoSubs.filter((x) => !member || x.id === "carteira" || (x.id === "sinais" && canRobo)).map((x) => (
                <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "pill on" : "pill"} onClick={() => setTab(x.id)}>{x.label}</button>
              ))}
            </nav>
            {!support && <div className="toolbar-actions">
              <button onClick={refresh} disabled={busy} className="primary small-btn" title="Sinais do robô, carteiras, fichas dos tokens e cotações">
                {busy ? "Atualizando..." : "Atualizar"}
              </button>
              <button className="ghost icon" onClick={() => setShowCfg(true)} aria-label="Configuração do cripto" title="Configuração do cripto">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              </button>
            </div>}
          </div>
        )}
        {tab === "sinais" && canRobo && (
          <>
            {member && <p className="banner">Estudo educacional: mostra como a regra do robô (SMA 150 + HMA 100) se comportou e onde está cada moeda em relação a ela.
              Não é recomendação de compra ou venda.</p>}
            {!latest.length && <p className="muted">Nenhum sinal ainda. Em Cripto, clique em &quot;Atualizar&quot;.</p>}
            <div className="grid">
              {[...latest].sort((a, b) => SYMBOLS.indexOf(a.symbol) - SYMBOLS.indexOf(b.symbol)).map((l) => (
                <AssetCard key={l.symbol} l={l} cfg={eff} prices={prices} study={member} />
              ))}
            </div>
            {/* Outras moedas para o robo: escondido ate dar para trocar as moedas do robo pela tela */}
            {SHOW_CANDIDATES && <CandidatesCard doc={candidates} />}
            {/* resultado real x estrategia e as fichas dos tokens ficam junto do robo */}
            {!member && <Performance cfg={eff} latest={latest} trades={trades} prices={prices} />}
            <div id="fichas"><FichasCard fichas={fichas} /></div>
          </>
        )}
        {tab === "ajuda" && <Manual member={member} robo={canRobo} />}
        {tab === "financas" && <FinanceCard cfg={cfg} fin={finance} wallet={walletOk ? wallet : null} spend={spend} debt={debt} months={months} setup={gSetup}
          onChanged={() => { refreshFinance().then((p) => p.length && setError(p.join("; "))); }}
          onQuotes={support ? undefined : async () => { const p = await refreshFinance(); if (p.length) setError(p.join("; ")); else setNotice(`Cotações atualizadas às ${new Date().toLocaleTimeString("pt-BR")}.`); }} />}
        {tab === "carteira" && <WalletCard wallet={wallet} history={walletHistory} cfg={eff} latest={latest} />}
        {tab === "operacoes" && !member && (
          <>
            <TradeForm cfg={cfg} latest={latest} prices={prices} />
            <TradesTable trades={trades} />
          </>
        )}

        <p className="muted small footer">Ferramenta educacional, não é recomendação de investimento. O candle diário fecha às 21:00 (Brasília).
          Opere só na sua carteira (DEX); a Binance é usada apenas como fonte de preços.</p>
      </main>
      {showCfg && (
        <Modal onClose={() => setShowCfg(false)}>
          {member ? <MemberConfigForm cfg={cfg} onClose={() => setShowCfg(false)} /> : <ConfigForm cfg={cfg} onClose={() => setShowCfg(false)} />}
        </Modal>
      )}
      {showAdmin && <Modal onClose={() => setShowAdmin(false)}><MembersAdmin onClose={() => setShowAdmin(false)} onSupport={enterSupport} /></Modal>}
      {showAccount && user && <Modal onClose={() => setShowAccount(false)}><MyAccount user={user} onClose={() => setShowAccount(false)} /></Modal>}
    </>
  );
}

type TabId = "geral" | "financas" | "sinais" | "carteira" | "tokens" | "operacoes" | "ajuda";
// Sub-abas de Cripto (continuam sendo "abas" por dentro, para os links da Visao geral abrirem direto a certa)
const CRYPTO_TABS: TabId[] = ["sinais", "carteira", "tokens", "operacoes"];

// Visao geral: patrimonio, o que fazer hoje, alocacao e posicoes do robo
type Money = Parameters<typeof PatrimonioCard>[0] extends infer P ? Omit<P, "onBens"> & { nwHist: NetWorthDoc[] } : never;
// Visao geral: patrimonio, o que fazer hoje, o mes e os proximos pagamentos, evolucao e, depois, o robo e a cripto
function Overview({ member, cfg, latest, prices, wallet, fichas, sync, onTab, money, onFin }: {
  member?: boolean; cfg: AppConfig; latest: LatestDoc[]; prices: Prices; wallet: WalletDoc | null; fichas: FichaDoc | null;
  sync: LighterSyncDoc | null; onTab: (t: TabId) => void; money: Money; onFin: (s: FinSub | "loans" | "recv") => void;
}) {
  const params = { ...DEFAULT_PARAMS, reentry: cfg.reentry };
  const [allTodo, setAllTodo] = useState(false);
  // Posicoes do robo e lucro aberto
  let open = 0;
  let invested = 0;
  let unknown = false;
  const rows: { symbol: string; pos: number; avg: number; price: number; usdt: number; pct: number }[] = [];
  for (const symbol of ordered(Object.keys(cfg.weights))) {
    const p = priceOf(symbol, latest, prices);
    const pos = cfg.positions[symbol] ?? 0;
    if (!p || !(pos > 0)) continue;
    const avg = cfg.avgPrice?.[symbol] ?? 0;
    const r = openPnl(cfg, symbol, p.price);
    open += r.usdt;
    unknown ||= !r.known;
    invested += pos * avg;
    rows.push({ symbol, pos, avg, price: p.price, usdt: r.usdt, pct: r.pct });
  }
  const realized = Object.values(cfg.realized ?? {}).reduce((a, b) => a + b, 0);

  // O que fazer hoje: sinais do robo, acoes das fichas e avisos da carteira
  type Todo = { tone: "buy" | "sell" | "warn" | "info"; who: string; text: string; tab: TabId; fin?: FinSub | "loans" | "recv"; prio?: number; id?: string };
  const todo: Todo[] = [];
  // Sinais do robo: uma linha so (os detalhes ficam na aba Robo). Previas nao entram aqui
  const sigs: { coin: string; sell: boolean; usd: number }[] = [];
  for (const l of member ? [] : [...latest].sort((a, b) => SYMBOLS.indexOf(a.symbol) - SYMBOLS.indexOf(b.symbol))) {
    const capital = cfg.capitalUsdt * (cfg.weights[l.symbol] ?? 0);
    const d = decide(l.state, capital, cfg.positions[l.symbol] ?? 0, params);
    if (d.qty > 0) sigs.push({ coin: l.symbol.replace("USDT", ""), sell: d.kind === "VENDER_TUDO" || d.kind === "VENDER_PARTE", usd: d.qty * l.state.close });
  }
  if (sigs.length) {
    const part = (sell: boolean) => { const x = sigs.filter((s) => s.sell === sell); return x.length ? `${sell ? "vender" : "comprar"} ${x.map((s) => s.coin).join(", ")} (~$${fmt(x.reduce((t, s) => t + s.usd, 0))})` : ""; };
    todo.push({ tone: sigs.every((s) => s.sell) ? "sell" : sigs.every((s) => !s.sell) ? "buy" : "warn", who: "Robô", prio: 2,
      text: `${sigs.length} ${sigs.length > 1 ? "sinais" : "sinal"} no fechamento das 21:00: ${[part(true), part(false)].filter(Boolean).join("; ")}`, tab: "sinais" });
  }
  // Fichas dos tokens: uma linha so
  const acts = (fichas?.items ?? []).filter((f) => !SYMBOLS.includes(`${f.symbol}USDT`) && f.situacao
    && (["entrada", "entrada_metade", "saida", "reduzir", "sem_vaga"].includes(f.situacao.code) || f.action));
  if (acts.length) todo.push({ tone: "info", who: "Tokens", prio: 3, tab: "sinais",
    text: acts.slice(0, 4).map((f) => `${f.symbol}: ${f.situacao!.label.toLowerCase()}`).join(" - ") + (acts.length > 4 ? ` e mais ${acts.length - 4}` : "") });
  if (wallet) for (const n of walletNotices(wallet)) if (n.level !== "info") todo.push({ tone: "warn", who: "Carteira", prio: 3, text: n.text, tab: "carteira" });
  if (unknown && !member) todo.push({ tone: "info", who: "Robô", prio: 3, text: "há posição sem preço médio: informe-o em Carteira > Meus tokens para ver o lucro", tab: "sinais" });
  if (sync?.shorts.length) todo.push({ tone: "warn", who: "Lighter", prio: 3, text: `posição vendida (${sync.shorts.join(", ")}) fica fora da conta`, tab: "carteira" });
  // Financas: so recalcula quando os dados de financas mudam (nao a cada atualizacao de preco do cripto, a cada 30 s)
  const finTodo = useMemo(() => {
    const todo: Todo[] = [];
    // Financas: pagamentos vencidos e pontos para revisar
    const upList = upcoming(money.months, money.setup);
    for (const p of upList.filter((x) => x.late))
      todo.push({ tone: "warn", who: "Pagar", prio: 1, id: `late:${p.desc}:${p.d}`, text: !p.loan && !p.card && !p.once
        ? `${p.desc} costuma sair até o dia ${p.d.slice(8, 10)} e ainda não veio no extrato (R$\u00a0${fmt(p.v)})`
        : `${p.desc}: R$\u00a0${fmt(p.v)} venceu em ${new Date(`${p.d}T12:00:00`).toLocaleDateString("pt-BR")}`, tab: "financas", fin: p.loan ? "loans" : p.card ? "cards" : "lanc" });
    for (const r of money.setup.recvs ?? []) {
      const st = recvStatus(r, money.months);
      if (st.late) todo.push({ tone: "warn", who: "Receber", text: `${r.name}: ${st.late} ${st.late > 1 ? "parcelas atrasadas" : "parcela atrasada"} (R$\u00a0${fmt(st.lateV)})`, tab: "financas", fin: "recv" });
    }
    for (const b of budgetAlerts(money.months, money.setup))
      todo.push({ tone: "warn", who: "Cartão", text: `${b.c.name}: R$\u00a0${fmt(b.used, 0)} na fatura aberta, ${fmt(b.pct * 100, 0)}% do planejado (R$\u00a0${fmt(b.c.budget!, 0)})`, tab: "financas", fin: "cards" });
    {
      const cm = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);
      for (const f of money.setup.fixos) if (fixoActive(f, cm) && fixoReajPending(f, cm))
        todo.push({ tone: "info", who: "Fixo", text: `${f.desc} reajusta este mês: atualize o novo valor (Lançamentos > Contas a pagar)`, tab: "financas", fin: "lanc" });
    }
    // entrada fixa que costuma cair e ainda nao veio
  {
    const t0 = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    const cm = t0.slice(0, 7);
    for (const b of monthIncomes(cm, money.months[cm]?.items ?? [], money.setup, money.months))
      if (!b.paid && b.d < t0) todo.push({ tone: "info", who: "Receber", prio: 2, id: `inc:${b.ref}:${cm}`, tab: "financas", fin: "lanc",
        text: `${b.desc} costuma cair até o dia ${b.d.slice(8, 10)} e ainda não veio no extrato (R$\u00a0${fmt(b.v)})` });
  }
  const rc = reviewCount(money.months, money.setup);
    if (rc) todo.push({ tone: "info", who: "Finanças", text: `${rc} ${rc > 1 ? "pontos" : "ponto"} para revisar nos lançamentos (para os números ficarem certos)`, tab: "financas", fin: "lanc" });

    // Avisos inteligentes das financas
    const acctNow = accountBalance(money.months, money.setup);
    const summary = financeSummary(money.cfg.finance ?? [], money.fin, money.wallet, money.spend?.value ?? money.cfg.monthlyCost, acctNow?.value, investFlows(money.months));
    for (const x of buildAlerts({ months: money.months, setup: money.setup, up: upList, saldo: acctNow?.value ?? null, avg: money.spend, reserve: summary.reserve, reserveMonths: summary.reserveMonths, hist: money.nwHist }))
      todo.push({ tone: x.tone, who: x.who, text: x.text, tab: "financas", fin: x.fin, prio: x.prio, id: x.id });
    return todo;
  }, [money.months, money.setup, money.cfg, money.fin, money.wallet, money.spend, money.nwHist]);
  todo.push(...finTodo);
  // Contra poluicao: tira os dispensados neste mes, os mais urgentes primeiro, no maximo 5 (o resto em "ver mais")
  const nowMonth = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);
  const idOf = (t: Todo) => t.id ?? (t.tab === "financas" ? `${t.who}:${t.text}` : null);
  const dismissed = money.setup.dismissed ?? {};
  const prioOf = (t: Todo) => t.prio ?? (t.tab !== "financas" ? (t.tone === "info" ? 3 : 0) : 2);
  const visible = todo.filter((t) => { const i = idOf(t); return !i || dismissed[i] !== nowMonth; }).map((t, i) => ({ t, i })).sort((x, y) => prioOf(x.t) - prioOf(y.t) || x.i - y.i).map((x) => x.t);
  const shownTodo = allTodo ? visible : visible.slice(0, 5);
  const dismiss = async (t: Todo) => {
    const i = idOf(t);
    if (!i) return;
    const keep = Object.fromEntries(Object.entries(dismissed).filter(([, v]) => v === nowMonth));
    await saveSetup({ dismissed: { ...keep, [i]: nowMonth } });
  };

  const total = wallet && wallet.address === walletKey(walletAddresses(cfg)) ? wallet.total : null;
  const blocks = total !== null && wallet ? allocationBlocks(wallet, cfg, latest, fichas) : [];
  const alloc = allocOf(cfg);
  const pctOf = (v: number) => (total ? `${fmt((v / total) * 100, 1)}%` : "");
  const hasMoney = !!(cfg.finance?.length || Object.keys(money.months).length || money.setup.cards.length || money.setup.loans.length);
  const go = (t: Todo) => (t.fin ? onFin(t.fin) : onTab(t.tab));
  // numeros do cripto: dentro do quadro Patrimonio (ou sozinhos, se ainda nao ha financas)
  const cryptoKpis = (
    <div className="kpis compact">
      <div><span>{hasMoney ? "Carteira cripto" : "Patrimônio"}</span><b>{total !== null ? `$${fmt(total)}` : "-"}</b>
        <small className="muted">{total === null ? "cadastre as carteiras" : member ? "suas carteiras" : `núcleo $${fmt(cfg.capitalUsdt)}`}</small></div>
      {!member && <><div><span>Lucro aberto (robô)</span><b className={pnlClass(open)}>{signed(open)}</b>
        <small className="muted">{invested > 0 ? `${signed((open / invested) * 100, 1)}% sobre $${fmt(invested)}` : "sem posição"}</small></div>
      <div><span>Realizado</span><b className={pnlClass(realized)}>{signed(realized)}</b><small className="muted">vendas registradas</small></div>
      <div><span>Total</span><b className={pnlClass(open + realized)}>{signed(open + realized)}</b><small className="muted">sem taxas e funding</small></div></>}
    </div>
  );

  return (
    <>
      {hasMoney && <PatrimonioCard {...money} start={money.cfg.nwStart ?? null} onBens={() => onFin("bens")}>
        <div className="sub-block">
          <div className="sub-head"><b>Cripto</b><button className="link" onClick={() => onTab("carteira")}>ver cripto &rsaquo;</button></div>
          {cryptoKpis}
        </div>
      </PatrimonioCard>}

      <section className="card">
        <h2>O que fazer hoje</h2>
        {visible.length ? (
          <>
          <ul className="todo">
            {shownTodo.map((t, i) => (
              <li key={i} className={`todo-${t.tone}`} onClick={() => go(t)}>
                <b>{t.who}</b><span>{t.text}</span>
                {idOf(t) ? <button className="link todo-x" title="Dispensar até o mês que vem" onClick={(e) => { e.stopPropagation(); dismiss(t); }}>dispensar</button> : <em />}
                <i aria-hidden="true">&rsaquo;</i>
              </li>
            ))}
          </ul>
          {visible.length > 5 && <button className="link" onClick={() => setAllTodo(!allTodo)}>{allTodo ? "ver menos" : `ver mais ${visible.length - 5}`}</button>}
          </>
        ) : (
          <p className="muted">Nada a fazer: nenhum sinal novo, nenhum pagamento vencido e nenhum aviso.</p>
        )}
        <Note>Os mais urgentes primeiro, no máximo 5 (o resto em &quot;ver mais&quot;). Clique num item para ver os detalhes; &quot;dispensar&quot;
          esconde o aviso até o mês que vem.{member ? "" : " Sinais do robô valem só no fechamento diário (21:00 de Brasília)."}</Note>
      </section>

      {hasMoney && <MonthAndUpcoming months={money.months} setup={money.setup} onLanc={() => onFin("lanc")} onBens={() => onFin("bens")} />}
      {hasMoney && <NetWorthBlock {...money} />}

      {!hasMoney && (
        <section className="card">
          <div className="card-head"><h2>Cripto</h2><button className="link" onClick={() => onTab("carteira")}>ver cripto &rsaquo;</button></div>
          {cryptoKpis}
        </section>
      )}


      {!member && <details className="more-block">
        <summary>Alocação e posições do robô</summary>
        <div className="two-col">
        <section className="card">
          <h2>Alocação</h2>
          {blocks.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Bloco</th><th>Alvo</th><th>Real</th><th>Diferença</th></tr></thead>
                <tbody>
                  {blocks.map((b) => (
                    <tr key={b.name}>
                      <td><b>{b.name}</b><div className="muted small">{b.hint}</div></td>
                      <td>{b.target === null ? "o resto" : `$${fmt(b.target)}`}<div className="muted small">{b.target === null ? "" : pctOf(b.target)}</div></td>
                      <td>${fmt(b.real)}<div className="muted small">{pctOf(b.real)}</div></td>
                      <td className={b.target !== null && Math.abs(b.real - b.target) > Math.max(5, 0.1 * (total ?? 0)) ? "warn" : "muted"}>
                        {b.target === null ? "-" : signed(b.real - b.target)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Cadastre as carteiras na engrenagem de Cripto e clique em &quot;Atualizar&quot;.</p>
          )}
          <Note>Divisão: núcleo {fmt(alloc.core * 100, 0)}% / satélite {fmt(alloc.satellite * 100, 0)}% (engrenagem em Cripto).</Note>
        </section>

        <section className="card">
          <h2>Posições do robô</h2>
          {rows.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Moeda</th><th>Posição</th><th>Preço médio</th><th>Agora</th><th>Lucro</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.symbol}>
                      <td><b>{r.symbol.replace("USDT", "")}</b></td><td>{fmtQty(r.pos)}</td>
                      <td>{r.avg > 0 ? fmtPx(r.avg) : "-"}</td><td>{fmtPx(r.price)}</td>
                      <td className={pnlClass(r.usdt)}>{r.avg > 0 ? `${signed(r.usdt)} (${signed(r.pct, 1)}%)` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Sem posição em BTC, ETH ou SOL.</p>
          )}
          <p className="muted small">Preço {prices.at ? `ao vivo (${ago(prices.at)})` : "do último cálculo"}.</p>
        </section>
        </div>
      </details>}
    </>
  );
}

// Seu resultado real x a estrategia seguida a risca, desde a primeira operacao registrada
function Performance({ cfg, latest, trades, prices }: { cfg: AppConfig; latest: LatestDoc[]; trades: TradeDoc[]; prices: Prices }) {
  if (!trades.length) return null;
  const perf = performance(cfg, latest, trades, prices.values);
  if (!perf)
    return (
      <section className="card">
        <h2>Real x estratégia</h2>
        <p className="muted small">Em Cripto, clique em &quot;Atualizar&quot; para carregar a série da estratégia.</p>
      </section>
    );
  const last = perf.points[perf.points.length - 1];
  const diff = last.real - last.strat;
  const pctOf = (v: number) => (perf.capital > 0 ? ` (${signed((v / perf.capital) * 100, 1)}%)` : "");
  return (
    <section className="card">
      <div className="card-head"><h2>Real x estratégia</h2><span className="muted small">desde {day(perf.start)}</span></div>
      <div className="summary perf">
        <div><span className="muted small">Seu resultado</span><b className={pnlClass(last.real)}>{signed(last.real)} USDT{pctOf(last.real)}</b></div>
        <div><span className="muted small">Estratégia a risca</span><b className={pnlClass(last.strat)}>{signed(last.strat)} USDT{pctOf(last.strat)}</b></div>
        <div><span className="muted small">Diferença</span><b className={pnlClass(diff)}>{signed(diff)} USDT</b></div>
      </div>
      <PerfChart points={perf.points} />
      <p className="legend small"><i className="k-real" /> seu resultado <i className="k-strat" /> estratégia a risca</p>
      <Note>
        A estratégia usa o capital configurado de cada moeda ({fmt(perf.capital)} USDT) e opera no fechamento das 21:00.
        A diferença mostra atraso, preço e tamanho diferentes dos sinais. Sem taxas e funding nos dois.
        {perf.clipped ? " As operações mais antigas que o gráfico (240 dias) entram no primeiro dia." : ""}
      </Note>
    </section>
  );
}

const EVENT_LABEL = { entrada: "Compra", reentrada: "Reentrada", cheia: "Posição cheia", meia: "Reduz a metade", saida: "Venda" } as const;
const pctFmt = (v: number, d = 1) => `${v > 0 ? "+" : ""}${fmt(v * 100, d)}%`;
// Preco de referencia com 2 casas (ou mais para moedas baratas): so para leitura, nao e quantidade
const refPx = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v >= 100 ? 2 : 4 });

// Card de uma moeda do robo: sinal oficial, previa, regras de saida/entrada, grafico e resultados com a saude da estrategia
function AssetCard({ l, cfg, prices, study }: { l: LatestDoc; cfg: AppConfig; prices: Prices; study?: boolean }) {
  const s = l.state;
  const params = { ...DEFAULT_PARAMS, reentry: cfg.reentry };
  const cur = currentPrice(l, prices);
  const pnl = openPnl(cfg, l.symbol, cur.price);
  const avg = cfg.avgPrice?.[l.symbol] ?? 0;
  const coin = l.symbol.replace("USDT", "");
  const capital = cfg.capitalUsdt * (cfg.weights[l.symbol] ?? 0);
  const pos = cfg.positions[l.symbol] ?? 0;
  const d = decide(s, capital, pos, params);
  const tone = d.kind === "VENDER_TUDO" || d.kind === "VENDER_PARTE" ? "sell" : d.qty > 0 ? "buy" : "hold";
  const buf = DEFAULT_PARAMS.bufferPct / 100;
  const ps = l.preview?.state;
  const pd = ps ? decide(ps, capital, pos, params) : null;
  const closeAt = s.t + 86_400_000; // o candle fecha 24 h depois de abrir (00:00 UTC = 21:00 de Brasilia)
  const when = new Date(closeAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const sma = s.sma ?? 0;
  const dist = (lvl: number) => (cur.price > 0 ? pctFmt(lvl / cur.price - 1) : "");
  const inMarket = s.expo > 0;
  const stats = l.stats ?? null;
  const ref = referenceOf(l.symbol, cfg.reentry);
  const h = stats ? health(stats, ref) : null;

  return (
    <section className="card asset">
      <div className="card-head">
        <h2>{coin} <span className="muted small">{inMarket ? `comprado ${fmt(s.expo * 100, 0)}% da fatia` : "fora do mercado"}</span></h2>
        <div className="price-now"><b>{fmtPx(cur.price)}</b><span className="muted small">{cur.live ? "ao vivo" : `recálculo ${ago(cur.at)}`}</span></div>
      </div>

      {study ? (
        <div className="signal hold">
          <span className="signal-tag">Estudo - fechamento de {when}</span>
          <b>{inMarket ? "Pela regra, estaria comprado" : "Pela regra, estaria fora"}</b>
        </div>
      ) : (
      <div className={`signal ${tone}`}>
        <span className="signal-tag">Sinal oficial - fechamento de {when} - vale até o próximo fechamento</span>
        <b>{d.label}</b>
        {d.qty > 0 && <span>{fmtQty(d.qty)} {coin} (~${fmt(d.qty * s.close)})</span>}
      </div>
      )}
      {!study && pd && ps && (
        <div className={`preview-box ${pd.kind !== d.kind ? "changes" : ""}`}>
          <span className="signal-tag">Prévia (não é sinal) - se o candle de hoje fechasse agora a {fmtPx(ps.close)}</span>
          {pd.kind !== d.kind ? <b>{pd.label}</b> : <span className="muted">sem mudança</span>}
        </div>
      )}

      {!study && pos > 0 && (
        <div className="pos-row">
          <span>Sua posição: <b>{fmtQty(pos)} {coin}</b> (~${fmt(pos * cur.price)})</span>
          <span className={pnlClass(pnl.usdt)}>{avg > 0 ? `${signed(pnl.usdt)} (${signed(pnl.pct, 1)}%)` : <span className="muted">sem preço médio</span>}</span>
        </div>
      )}

      <div className="rules">
        <span className="small muted">{inMarket ? "Saídas (qualquer uma vale, no fechamento):" : "Para entrar (no fechamento):"}</span>
        <ul>
          {inMarket ? (
            <>
              <li><span>Fechar abaixo da SMA 150 - 2%</span><b>{refPx(sma * (1 - buf))}</b><i className="muted small">{dist(sma * (1 - buf))}</i></li>
              <li><span>HMA 100 virar para baixo</span><b className={s.hmaDown ? "warn" : "pos"}>{s.hmaDown ? "caindo" : "subindo"}</b><i /></li>
              {s.stop !== null && <li><span>Fechar abaixo do stop da reentrada</span><b>{refPx(s.stop)}</b><i className="muted small">{dist(s.stop)}</i></li>}
            </>
          ) : (
            <>
              <li><span>Fechar acima da SMA 150 + 2%</span><b>{refPx(sma * (1 + buf))}</b><i className="muted small">{dist(sma * (1 + buf))}</i></li>
              <li><span>e a HMA 100 subindo</span><b className={s.hmaDown ? "warn" : "pos"}>{s.hmaDown ? "caindo" : "subindo"}</b><i /></li>
              {cfg.reentry && <li><span>ou repique na SMA (meia posição)</span><b>{refPx(sma)}</b><i className="muted small">{dist(sma)}</i></li>}
            </>
          )}
        </ul>
      </div>

      <Chart chart={l.chart} />
      <p className="legend small"><i className="k-close" /> preço <i className="k-sma" /> SMA {DEFAULT_PARAMS.sma} <i className="k-hma" /> HMA {DEFAULT_PARAMS.hma} <i className="k-band" /> comprado</p>

      {stats && h && (
        <div className="results">
          <div className="card-head">
            <h3>Resultados do robô</h3>
            <span className={`health health-${h.level}`}>{h.label}</span>
          </div>
          {h.reasons.length > 0 && <ul className="alerts small">{h.reasons.map((r) => <li key={r} className={h.level === "bad" ? "error" : "warn"}>{r}</li>)}</ul>}
          <div className="stat-grid">
            <div><span>Robô</span><b className={pnlClass(stats.totalRet)}>{pctFmt(stats.totalRet, 0)}</b><small>só segurar {pctFmt(stats.bhRet, 0)}</small></div>
            <div><span>Pior queda</span><b>{pctFmt(stats.mdd, 0)}</b><small>só segurar {pctFmt(stats.bhMdd, 0)}{ref ? ` - teste ${pctFmt(ref.mdd, 0)}` : ""}</small></div>
            <div><span>Queda agora</span><b className={stats.curDD < -0.1 ? "warn" : ""}>{pctFmt(stats.curDD, 0)}</b><small>{stats.daysUnderwater} dias sem novo pico</small></div>
            <div><span>12 meses</span><b className={pnlClass(stats.last12?.strat ?? 0)}>{stats.last12 ? pctFmt(stats.last12.strat, 0) : "-"}</b>
              <small>{stats.last12 ? `só segurar ${pctFmt(stats.last12.bh, 0)}` : ""}</small></div>
            <div><span>Trades</span><b>{stats.count}</b><small>acerto {fmt(stats.win * 100, 0)}%{ref ? ` (teste ${fmt(ref.win * 100, 0)}%)` : ""}</small></div>
            <div><span>Ganho / perda média</span><b>{pctFmt(stats.avgWin, 0)} / {pctFmt(stats.avgLoss, 1)}</b>
              <small>perdas seguidas: {stats.streakNow} (max {stats.streakMax}{ref ? `, teste ${ref.streak}` : ""})</small></div>
          </div>
          <ul className="events trades">
            {stats.trades.slice(0, 6).map((t) => (
              <li key={t.entry}>
                <div className="ev-top">
                  <span className="muted">{day(t.entry)} - {t.exit ? day(t.exit) : "aberto"}</span>
                  <span className="muted small">{t.days} dias</span>
                  <span className={`ev-ret ${pnlClass(t.ret)}`}>{pctFmt(t.ret)}</span>
                </div>
              </li>
            ))}
          </ul>
          <Note>
            Desde {day(stats.since)} ({fmt(stats.years, 1)} anos de gráficos disponíveis), seguindo o robô a risca com a fatia cheia, a vista e 0,1% de taxa.
            &quot;Teste&quot; = backtest até 07/2024. A estratégia para de fazer sentido se a queda ou as perdas seguidas passarem bem do teste.
          </Note>
        </div>
      )}

      <details className="history">
        <summary className="small">Detalhes e histórico de sinais ({l.events?.length ?? 0})</summary>
        <dl>
          <dt>Fechamento do candle</dt><dd>{fmtPx(s.close)}</dd>
          <dt>SMA {DEFAULT_PARAMS.sma}</dt><dd>{fmtPx(sma)} ({fmt(((s.close / (sma || s.close)) - 1) * 100, 1)}%)</dd>
          <dt>HMA {DEFAULT_PARAMS.hma}</dt><dd className={s.hmaDown ? "warn" : ""}>{s.hmaDown ? "caindo" : "subindo"}{s.turnDown ? " (virou hoje)" : ""}</dd>
          <dt>Volatilidade 30d</dt><dd>{fmt((s.vol ?? 0) * 100, 0)}% ao ano</dd>
          <dt>Exposição alvo</dt><dd>{fmt(s.expo * 100, 0)}% = {fmtQty(d.targetQty)} {coin}</dd>
          <dt>Fatia do robô</dt><dd>${fmt(capital)}</dd>
        </dl>
        {l.events?.length ? (
          <ul className="events">
            {[...l.events].reverse().map((e) => (
              <li key={e.t}>
                <div className="ev-top">
                  <span className="muted">{day(e.t)}</span>
                  <b className={e.kind === "saida" || e.kind === "meia" ? "neg" : "pos"}>{EVENT_LABEL[e.kind]}</b>
                  <span>{fmtPx(e.price)}</span>
                  {e.ret !== null && <span className={`ev-ret ${pnlClass(e.ret)}`}>{signed(e.ret * 100, 1)}%</span>}
                </div>
                <div className="muted small">{e.reason}</div>
              </li>
            ))}
          </ul>
        ) : null}
        <Note>% na venda = variação do preço desde a entrada (sem o tamanho da posição).</Note>
      </details>
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
    if (!(p > 0)) return setMsg("Informe o preço.");
    const { pos: next, avg: nextAvg, realized } = applyTrade(
      { pos: cfg.positions[symbol] ?? 0, avg: cfg.avgPrice?.[symbol] ?? 0, realized: cfg.realized?.[symbol] ?? 0 }, side, q, p);
    await addDoc(collection(db(), "trades"), { symbol, side, qty: q, price: p, t: Date.now() } satisfies TradeDoc);
    await setDoc(doc(db(), "config/main"),
      { positions: { [symbol]: round8(next) }, avgPrice: { [symbol]: round8(nextAvg) }, realized: { [symbol]: round8(realized) } },
      { merge: true });
    setQty("");
    setPrice("");
    setMsg(`Registrado. Posição em ${symbol}: ${fmtQty(next)}${next > 0 ? ` a preço médio ${fmtPx(nextAvg)}` : ""}.`);
  }

  return (
    <section className="card">
      <h2>Registrar operação manual</h2>
      <div className="info-box small">
        <b>Comprou ou vendeu numa carteira cadastrada (Rabby, Phantom...)? Não precisa lançar nada.</b> O site lê o saldo das carteiras
        sozinho quando você clica em &quot;Atualizar&quot; (e o agendador atualiza ao longo do dia); as operações da Lighter também entram sozinhas quando a importação dela está ligada na engrenagem.
        Use este formulário só para o que foi feito fora das carteiras cadastradas, por exemplo numa carteira que não está na engrenagem.
      </div>
      <div className="row wrap-row">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{symbols.map((s) => <option key={s} value={s}>{s.replace("USDT", "")}</option>)}</select>
        <select value={side} onChange={(e) => setSide(e.target.value as "compra" | "venda")}><option value="compra">compra</option><option value="venda">venda</option></select>
        <input placeholder="quantidade" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        <input placeholder="preço (vazio = atual)" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
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

// Configuracao em secoes: capital, carteiras, robo, tokens e (recolhidos) ajustes manuais e Lighter
function ConfigForm({ cfg, onClose }: { cfg: AppConfig; onClose: () => void }) {
  const [draft, setDraft] = useState(cfg);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [watchText, setWatchText] = useState((cfg.watchlist ?? []).join(", "));
  const [walletText, setWalletText] = useState((cfg.wallets?.length ? cfg.wallets : cfg.wallet ? [cfg.wallet] : []).join("\n"));

  async function save() {
    const clean = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round8(v)]));
    const wallets = [...new Set(walletText.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean))];
    const bad = wallets.filter((a) => !isEvmAddress(a) && !isSolAddress(a));
    if (bad.length) return setErr(`Endereço inválido: ${bad.join(", ")} (EVM = 0x + 40 caracteres; Solana = 32 a 44 caracteres).`);
    if (draft.lighter?.enabled && !wallets.some(isEvmAddress)) return setErr("Para importar da Lighter, informe um endereço EVM (0x...).");
    if ((draft.capitalFromWallet || draft.walletPositions) && !wallets.length) return setErr("Informe pelo menos uma carteira para usar o patrimônio ou o saldo dela.");
    setSaving(true);
    await setDoc(doc(db(), "config/main"), {
      ...draft, wallet: wallets.find(isEvmAddress) ?? "", wallets,
      watchlist: [...new Set(watchText.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9]{2,12}$/.test(t)))],
      weights: clean(draft.weights), positions: clean(draft.positions), avgPrice: clean(draft.avgPrice), realized: clean(draft.realized),
    });
    setSaving(false);
    onClose();
  }

  const symbols = ordered(Object.keys(draft.weights));
  const totalWeight = Object.values(draft.weights).reduce((a, b) => a + b, 0);
  const setMap = (key: "weights" | "positions" | "avgPrice", s: string, v: number) =>
    setDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [s]: v } });
  const alloc = draft.alloc ?? DEFAULT_ALLOC;
  const setCore = (pctCore: number) => {
    const c = Math.min(100, Math.max(0, pctCore)) / 100;
    setDraft({ ...draft, alloc: { core: round8(c), satellite: round8(1 - c) } });
  };

  return (
    <section className="cfg">
      <div className="modal-head">
        <h2>Configuração</h2>
        <button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button>
      </div>

      <fieldset>
        <legend>1. Capital</legend>
        <div className="choice">
          <label className="radio">
            <input type="radio" checked={!!draft.capitalFromWallet} onChange={() => setDraft({ ...draft, capitalFromWallet: true })} />
            <span><b>Patrimônio das carteiras</b><small>o total lido nas carteiras abaixo (recomendado)</small></span>
          </label>
          <label className="radio">
            <input type="radio" checked={!draft.capitalFromWallet} onChange={() => setDraft({ ...draft, capitalFromWallet: false })} />
            <span><b>Valor fixo</b><small>digite o capital em USDT</small></span>
          </label>
          {!draft.capitalFromWallet && (
            <label className="inline">USDT <NumInput value={draft.capitalUsdt} onChange={(v) => setDraft({ ...draft, capitalUsdt: v })} /></label>
          )}
        </div>
        <div className="split">
          <label>Núcleo (robô BTC/ETH/SOL) %<NumInput value={round8(alloc.core * 100)} onChange={setCore} /></label>
          <label>Satélite (rompimento em outros tokens) %<NumInput value={round8(alloc.satellite * 100)} onChange={(v) => setCore(100 - v)} /></label>
        </div>
        <p className="hint">O robô usa só o núcleo; o satélite tem até 5 tokens. Satélite 0% desliga o rompimento.</p>
      </fieldset>

      <fieldset>
        <legend>2. Carteiras</legend>
        <label>Endereços públicos, um por linha (EVM 0x... da Rabby/Phantom e Solana da Phantom)
          <textarea rows={3} value={walletText} placeholder={"0x... (Rabby)\n7xKX... (Phantom Solana)"} spellCheck={false}
            onChange={(e) => setWalletText(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={!!draft.walletPositions} onChange={(e) => setDraft({ ...draft, walletPositions: e.target.checked })} />
          A posição do robô vem do saldo das carteiras (cbBTC, WETH, stETH, JitoSOL... contam como BTC/ETH/SOL)
        </label>
        <p className="hint">Só leitura pelo endereço público: nunca pede chave nem assinatura.</p>
      </fieldset>

      <fieldset>
        <legend>3. Robô (BTC, ETH, SOL)</legend>
        <div className="table-scroll">
          <table className="cfg-table">
            <thead><tr><th>Moeda</th><th>Peso no núcleo (%)</th>{!draft.walletPositions && <th>Preço médio (para o lucro)</th>}</tr></thead>
            <tbody>
              {symbols.map((s) => (
                <tr key={s}>
                  <td><b>{s.replace("USDT", "")}</b></td>
                  <td><NumInput value={round8(draft.weights[s] * 100)} onChange={(v) => setMap("weights", s, v / 100)} /></td>
                  {!draft.walletPositions && <td><NumInput value={draft.avgPrice?.[s] ?? 0} onChange={(v) => setMap("avgPrice", s, v)} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draft.walletPositions && <p className="hint">Preço médio: vem da lista &quot;Meus tokens&quot; (aba Carteira), automático ou digitado la.</p>}
        {Math.abs(totalWeight - 1) > 0.011 && <p className="warn small">Os pesos somam {fmt(totalWeight * 100, 0)}%: o normal e 100%.</p>}
        <label className="check">
          <input type="checkbox" checked={draft.reentry} onChange={(e) => setDraft({ ...draft, reentry: e.target.checked })} />
          Reentrada no repique (meia posição quando o preço volta a SMA com a HMA caindo)
        </label>
      </fieldset>

      <fieldset>
        <legend>4. Tokens</legend>
        <label>Tokens extras para acompanhar nas fichas (separados por vírgula)
          <input value={watchText} placeholder="HYPE, PENDLE, JUP" spellCheck={false} onChange={(e) => setWatchText(e.target.value)} />
        </label>
        <p className="hint">Os tokens das suas carteiras e uma lista padrão de projetos grandes já entram sozinhos. Os da lista padrão são só para acompanhar: não geram aviso de compra. Digitando um deles aqui, ele passa a seguir a regra completa.</p>
      </fieldset>

      <details className="cfg-more">
        <summary>Posições manuais (fora das carteiras)</summary>
        <p className="hint">Só para o que não está nas carteiras cadastradas. Registrar uma operação atualiza estes valores sozinho.
          {draft.walletPositions ? " Com a posição vindo das carteiras, estes valores são ignorados." : ""}</p>
        <div className="table-scroll">
          <table className="cfg-table">
            <thead><tr><th>Moeda</th><th>Posição (moedas)</th></tr></thead>
            <tbody>
              {symbols.map((s) => (
                <tr key={s}>
                  <td><b>{s.replace("USDT", "")}</b></td>
                  <td><NumInput value={draft.positions[s] ?? 0} onChange={(v) => setMap("positions", s, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="cfg-more" open={!!draft.lighter?.enabled}>
        <summary>Lighter (perpétuos)</summary>
        <label className="check">
          <input type="checkbox" checked={!!draft.lighter?.enabled}
            onChange={(e) => setDraft({ ...draft, lighter: { enabled: e.target.checked, since: draft.lighter?.since ?? Date.now() - 30 * 86_400_000 } })} />
          Importar posições e operações da Lighter
        </label>
        {draft.lighter?.enabled && (
          <label className="inline">Operações a partir de
            <input type="date" value={new Date(draft.lighter.since).toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && setDraft({ ...draft, lighter: { enabled: true, since: Date.parse(`${e.target.value}T00:00:00Z`) } })} />
          </label>
        )}
        <p className="hint">Desligue depois de sacar da Lighter.</p>
      </details>

      <div className="cfg-footer">
        {err && <p className="error small">{err}</p>}
        <div className="row">
          <button className="primary" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
          <button className="ghost" onClick={onClose}>Cancelar</button>
        </div>
        <p className="hint">Depois de salvar, clique em &quot;Atualizar&quot; (Cripto) para recalcular com a nova configuração.</p>
      </div>
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

const RECALC_NOTE = "A posição, o preço médio e o realizado da moeda serão refeitos a partir de TODAS as operações registradas dela " +
  "(ajustes feitos à mão na Configuração serão substituídos).";

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
    if (!(q > 0) || !(p > 0) || !Number.isFinite(t)) return setMsg("Quantidade, preço e data precisam ser válidos.");
    if (!await ask(`Salvar a alteração?\n\n${RECALC_NOTE}`)) return;
    try {
      const books = await saveTradeChange(trades, {
        id: editing.id, next: { symbol: editing.symbol, side: editing.side, qty: round8(q), price: round8(p), t },
      });
      setEditing(null);
      setMsg(`Operação alterada. Posição agora: ${summary(books)}.`);
    } catch (e) {
      setMsg(`Não foi possível salvar: ${String(e)}`);
    }
  }

  async function remove(t: TradeRow) {
    const what = `${t.side} de ${fmtQty(t.qty)} ${t.symbol.replace("USDT", "")} a ${fmtPx(t.price)} em ${new Date(t.t).toLocaleString("pt-BR")}`;
    if (!await ask(`Excluir a ${what}?\n\n${RECALC_NOTE}`)) return;
    try {
      const books = await saveTradeChange(trades, { id: t.id, next: null });
      setMsg(`Operação excluída. Posição agora: ${summary(books)}.`);
    } catch (e) {
      setMsg(`Não foi possível excluir: ${String(e)}`);
    }
  }

  return (
    <section className="card">
      <div className="row between wrap-row trades-head">
        <h2>Operações registradas</h2>
        <div className="row wrap-row">
          <input type="search" placeholder="Buscar (data, moeda, preço...)" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        <p className="muted">Nenhuma operação encontrada com esses filtros.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="stack">
              <thead><tr><th>Data</th><th>Moeda</th><th>Lado</th><th>Qtd</th><th>Preço</th><th>Valor (USDT)</th><th /></tr></thead>
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
                    <td data-label="Moeda">{t.symbol.replace("USDT", "")}{t.source === "lighter" && <span className="tag">Lighter</span>}</td>
                    <td data-label="Lado" className={t.side === "compra" ? "pos" : "neg"}>{t.side}{t.note ? ` (${t.note})` : ""}</td>
                    <td data-label="Qtd">{fmtQty(t.qty)}</td>
                    <td data-label="Preço">{fmtPx(t.price)}</td>
                    <td data-label="Valor (USDT)">{fmt(t.qty * t.price)}</td>
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
              {rows.length} opera{rows.length === 1 ? "ção" : "ções"}{rows.length !== trades.length ? ` (de ${trades.length})` : ""}
            </span>
            <div className="row">
              <button className="ghost" onClick={() => setPage(cur - 1)} disabled={cur === 0}>Anterior</button>
              <span className="small">Página {cur + 1} de {pages}</span>
              <button className="ghost" onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1}>Próxima</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- membros ----------
// Configuracao do membro: so as carteiras (o resto do robo e do dono)
function MemberConfigForm({ cfg, onClose }: { cfg: AppConfig; onClose: () => void }) {
  const [walletText, setWalletText] = useState((cfg.wallets ?? []).join("\n"));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const wallets = [...new Set(walletText.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean))];
    const bad = wallets.filter((a) => !isEvmAddress(a) && !isSolAddress(a));
    if (bad.length) return setErr(`Endereço inválido: ${bad.join(", ")} (EVM = 0x + 40 caracteres; Solana = 32 a 44 caracteres).`);
    setSaving(true);
    try {
      await setDoc(doc(db(), P("config/main")), { wallets, wallet: wallets.find(isEvmAddress) ?? "" }, { merge: true });
      onClose();
    } catch (e) { setSaving(false); setErr(`Não salvou: ${String(e)}`); }
  };
  return (
    <section className="cfg">
      <div className="modal-head"><h2>Suas carteiras</h2><button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button></div>
      <p className="muted small">Endereços públicos das suas carteiras (Rabby, Phantom...), um por linha. Só leitura: o site nunca pede frase secreta nem movimenta nada.</p>
      <textarea className="wallets" rows={4} value={walletText} onChange={(e) => setWalletText(e.target.value)} placeholder="0x... ou endereço Solana" />
      {err && <p className="error small">{err}</p>}
      <div className="row"><button className="primary" disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar"}</button>
        <button className="ghost" onClick={onClose}>Cancelar</button></div>
      <p className="muted small">Depois de salvar, clique em &quot;Atualizar&quot; (Cripto) para ler as carteiras.</p>
    </section>
  );
}

// Administracao (so o dono): quem pode entrar
function MembersAdmin({ onClose, onSupport }: { onClose: () => void; onSupport: (x: { uid: string; email: string; until: number }) => void }) {
  const [grants, setGrants] = useState<{ uid: string; email: string; until: number }[]>([]);
  useEffect(() => onSnapshot(collection(db(), "support"), (s) => setGrants(s.docs.map((d) => ({ uid: d.id, ...(d.data() as { email: string; until: number }) }))), () => undefined), []);
  const [list, setList] = useState<{ email: string; name?: string; at?: number; robo?: boolean }[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [lvl, setLvl] = useState<"robo" | "basico">("robo");
  const [err, setErr] = useState("");
  useEffect(() => onSnapshot(collection(db(), "access"), (s) => setList(s.docs.filter((d) => (d.data() as { role?: string }).role === "member")
    .map((d) => ({ email: d.id, ...(d.data() as { name?: string; at?: number; robo?: boolean }) })).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))),
    (e) => setErr(e.message.includes("permission") ? "As regras do Firestore ainda não foram atualizadas (veja firestore.rules)." : e.message)), []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return setErr("E-mail inválido.");
    setErr("");
    try {
      await setDoc(doc(db(), "access", em), { role: "member", at: Date.now(), robo: lvl === "robo", ...(name.trim() ? { name: name.trim() } : {}) });
      setEmail(""); setName("");
    } catch (x) { setErr(`Não salvou: ${String(x)}`); }
  };
  const setLevel = async (em: string, on: boolean) => {
    try { await setDoc(doc(db(), "access", em), { robo: on }, { merge: true }); } catch (x) { setErr(`Não salvou: ${String(x)}`); }
  };
  const remove = async (em: string) => {
    if (!(await ask(`Remover o acesso de ${em}? Os dados dele continuam guardados; ele só não entra mais.`))) return;
    await deleteDoc(doc(db(), "access", em));
  };
  return (
    <section className="cfg">
      <div className="modal-head"><h2>Membros</h2><button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button></div>
      <p className="muted small">Só entra quem estiver nesta lista (o e-mail da conta Google). Cada membro tem os próprios dados; ninguém vê os seus nem os de outro membro.
        Nível: &quot;com Robô e tokens&quot; vê os sinais do robô (como estudo) e as fichas dos tokens, sem nada da sua carteira; &quot;sem&quot; vê só finanças e a própria carteira cripto.
        Mudar o nível vale no próximo acesso do membro.</p>
      <form className="row wrapline" onSubmit={add}>
        <label className="grow">E-mail Google<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="membro@gmail.com" /></label>
        <label>Nome (opcional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Nível
          <select value={lvl} onChange={(e) => setLvl(e.target.value as "robo" | "basico")}>
            <option value="robo">Com Robô e tokens</option>
            <option value="basico">Sem Robô e tokens</option>
          </select>
        </label>
        <button className="primary" type="submit">Liberar acesso</button>
      </form>
      {err && <p className="error small">{err}</p>}
      {list === null ? <p className="muted small">Carregando...</p> : list.length ? (
        <ul className="pend small members">
          {list.map((m) => (
            <li key={m.email}><b>{m.email}</b>{m.name && <span className="muted">{m.name}</span>}
              <select className="lvl-sel" value={m.robo === false ? "basico" : "robo"} aria-label={`Nível de ${m.email}`}
                onChange={(e) => setLevel(m.email, e.target.value === "robo")}>
                <option value="robo">com Robô e tokens</option>
                <option value="basico">sem Robô e tokens</option>
              </select>
              <span className="muted">{m.at ? `desde ${new Date(m.at).toLocaleDateString("pt-BR")}` : ""}</span>
              {(() => { const g = grants.find((x) => x.email === m.email && x.until > Date.now()); return g
                ? <button className="primary small-btn" onClick={() => onSupport(g)}>Ver conta (suporte)</button> : <span className="muted">sem suporte liberado</span>; })()}
              <button className="link" onClick={() => remove(m.email)}>remover</button></li>
          ))}
        </ul>
      ) : <p className="muted small">Nenhum membro liberado ainda.</p>}
    </section>
  );
}

// Minha conta (membro): privacidade e apagar os dados
function MyAccount({ user, onClose }: { user: User; onClose: () => void }) {
  const [until, setUntil] = useState<number | null>(null);
  useEffect(() => {
    try { return onSnapshot(doc(db(), "support", user.uid), (s) => setUntil(s.exists() ? (s.data() as { until: number }).until : null), () => undefined); }
    catch { return undefined; }
  }, [user.uid]);
  const active = until !== null && until > Date.now();
  const allow = async () => {
    if (!(await ask("Permitir suporte por 24 horas? O SeuBitico poderá VER seus dados do site (lançamentos, cartões, investimentos, carteiras), sem poder alterar nada. Você pode encerrar quando quiser."))) return;
    try { await setDoc(doc(db(), "support", user.uid), { email: (user.email ?? "").toLowerCase(), until: Date.now() + 86_400_000, at: Date.now() }); }
    catch (e) { await tell(`Não foi possível liberar: ${String(e)}`); }
  };
  const stop = async () => { try { await deleteDoc(doc(db(), "support", user.uid)); } catch (e) { await tell(`Não foi possível encerrar: ${String(e)}`); } };
  const [busy, setBusy] = useState(false);
  const wipe = async () => {
    if (!(await ask("Apagar todos os seus dados do site (lançamentos, cartões, investimentos, carteiras)? Não dá para desfazer."))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await tell("Seus dados foram apagados.");
      location.reload();
    } catch (e) { setBusy(false); await tell(`Não apagou: ${String(e)}`); }
  };
  return (
    <section className="cfg">
      <div className="modal-head"><h2>Minha conta</h2><button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button></div>
      <p className="small">Entrou como <b>{user.email}</b>.</p>
      <h3>Suporte</h3>
      {active
        ? <p className="small"><b className="warn">Suporte liberado</b> até {new Date(until!).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. O SeuBitico pode ver seus dados, sem alterar nada.
            <button className="ghost small-btn" onClick={stop}>Encerrar agora</button></p>
        : <p className="small muted">Se precisar de ajuda, você pode liberar a leitura da sua conta por 24 horas. Só você libera e pode encerrar quando quiser.
            <button className="ghost small-btn" onClick={allow}>Permitir suporte por 24 horas</button></p>}
      <h3>Privacidade</h3>
      <ul className="small privacy">
        <li>Seus dados ficam guardados no banco do site (Google Firebase), num espaço só seu: pelo site, ninguém além de você consegue ver, exceto se você liberar o suporte acima.</li>
        <li>Carteiras cripto: só o endereço público, lido em modo leitura. Nunca peça nem informe frase secreta ou chave privada.</li>
        <li>Nada aqui é recomendação de investimento: é uma ferramenta educacional de organização.</li>
      </ul>
      <h3>Exportar meus dados</h3>
      <ExportData owner={false} />
      <h3>Apagar</h3>
      <div className="row"><button className="danger" disabled={busy} onClick={wipe}>{busy ? "Apagando..." : "Apagar meus dados"}</button></div>
    </section>
  );
}
