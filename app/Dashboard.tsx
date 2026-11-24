"use client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { collection, doc, documentId, getDoc, getDocs, limitToLast, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { auth, db, firebaseConfigured } from "@/lib/firebaseClient";
import { P, memberBase, setDataBase, setReadOnly } from "@/lib/paths";
import { effectiveConfig } from "@/lib/positions";
import { walletAddresses, walletKey } from "@/lib/addresses";
import { fmtBR, subStatus } from "@/lib/assinatura";
import { DEFAULT_CONFIG, SYMBOLS, type AppConfig, type LatestDoc, type FichaDoc, type LighterSyncDoc, type FinanceDoc, type TradeDoc, type WalletDoc, type WalletHistoryDoc } from "@/lib/types";
import dynamic from "next/dynamic";
import type { Sub as FinSub } from "./FinanceCard";
import type { NetWorthDoc } from "@/lib/patrimonio";
import { EMPTY_SETUP, debts, setCardsReg, avgMonthly, setCustomCats, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import type { CandidatesDoc } from "@/lib/candidates";
import { usePrices } from "./usePrices";
import ScrollHints from "./ScrollHints";
import Shell, { type MoreItem, type NavId } from "./Shell";
import LaunchSheet from "./LaunchSheet";
import type { FinView } from "./FinanceCard";
import { ArrowLeftRight, Bitcoin, Bot, CircleHelp, ShoppingCart, UserRound, Users } from "lucide-react";
import { CRYPTO_TABS, Modal, TabId, ago, day, fmt, priceOf } from "./dash/util";
import { Overview } from "./dash/Overview";
import { AssetCard, Performance } from "./dash/Robo";
import { TradeForm, TradesTable } from "./dash/Trades";
import { ConfigForm, MemberConfigForm } from "./dash/ConfigForms";
import { MembersAdmin, MyAccount } from "./dash/Members";
const SHOW_CANDIDATES = false;
// Abas que carregam so quando abertas (a Visao geral abre sem baixar o codigo delas)
const loadingTab = () => <p className="muted">Carregando...</p>;
const FinanceCard = dynamic(() => import("./FinanceCard"), { loading: loadingTab });
const WalletCard = dynamic(() => import("./WalletCard"), { loading: loadingTab });
const FichasCard = dynamic(() => import("./FichasCard"), { loading: loadingTab });
const CandidatesCard = dynamic(() => import("./CandidatesCard"), { loading: loadingTab });
const Manual = dynamic(() => import("./Manual"), { loading: loadingTab });

// Dados de exemplo para conferir o visual sem login (so usado em paginas de teste locais)
export type Demo = {
  cfg: AppConfig; latest: LatestDoc[]; trades: (TradeDoc & { id: string })[]; wallet: WalletDoc | null;
  walletHistory: WalletHistoryDoc[]; fichas: FichaDoc | null; candidates?: CandidatesDoc | null; finance?: FinanceDoc | null;
  months?: Record<string, MonthDoc>; setup?: GastosSetup; nwHist?: NetWorthDoc[];
  member?: boolean; // demo vista como membro
  until?: number; // demo: vencimento da assinatura do membro
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
  // Financas virou tres telas: Mes (lancamentos), Patrimonio (contas e bens, investimentos, cartoes) e Lista de compras
  const [finView, setFinView] = useState<FinView>("mes");
  useEffect(() => {
    try {
      const v = localStorage.getItem("finView") as FinView | null;
      const old = localStorage.getItem("finSub") ?? "lanc";
      setFinView(v === "mes" || v === "patrimonio" || v === "compras" ? v
        : old === "lanc" || old === "gastos" || old === "resumo" ? "mes" : old === "compras" ? "compras" : "patrimonio");
    } catch { /* sem armazenamento */ }
  }, []);
  const goFin = (v: FinView) => {
    setFinView(v);
    try { localStorage.setItem("finView", v); } catch { /* sem armazenamento */ }
    setTab("financas");
  };
  const [launch, setLaunch] = useState(false);
  const prices = usePrices(user ? Object.keys(cfg.weights) : []);

  useEffect(() => (demo ? undefined : firebaseConfigured ? onAuthStateChanged(auth(), setUser) : setUser(null)), [demo]);
  // Quem entrou: dono (le a raiz, como sempre), membro (access/{email} -> users/{uid}/) ou sem acesso
  const [role, setRole] = useState<"owner" | "member" | "none" | null>(demo ? (demo.member ? "member" : "owner") : null);
  // vencimento da assinatura do membro (so aviso: ninguem e bloqueado por ele)
  const [until, setUntil] = useState<number | null>(demo?.until ?? null);
  useEffect(() => {
    if (demo || !user) return;
    let alive = true;
    (async () => {
      const email = (user.email ?? "").toLowerCase();
      try {
        const a = await getDoc(doc(db(), "access", email));
        if (a.exists() && (a.data() as { role?: string }).role === "member") {
          setDataBase(memberBase(user.uid));
          if (alive) { setUntil(typeof (a.data() as { until?: unknown }).until === "number" ? (a.data() as { until: number }).until : null); setRole("member"); }
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
  // Robo e tokens: so o dono (membro pagante ve so financas e a propria carteira). No suporte, o dono continua vendo
  const canRobo = !member || !!support;
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
    const u2 = role === "member" ? none : onSnapshot(collection(db(), "latest"), (s) => setLatest(s.docs.map((d) => d.data() as LatestDoc)), onErr);
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
    // fichas dos tokens: so o dono (no suporte ele le a copia publica, sem a carteira dele)
    const u7 = role === "member" ? none : onSnapshot(doc(db(), owner ? "fichas/main" : "fichas_pub/main"), (s) => setFichas(s.exists() ? (s.data() as FichaDoc) : null), () => setFichas(null));
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
  }, [user, demo, role, support]);

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

  // Sub-telas de Cripto (continuam sendo "abas" por dentro, para os links do Inicio abrirem direto a certa)
  const cryptoSubs = [
    { id: "carteira", label: "Carteira" },
    { id: "sinais", label: "Robô e tokens" },
    { id: "operacoes", label: "Operações manuais" },
  ] as const;
  const inCrypto = CRYPTO_TABS.includes(tab);
  const updatedAt = Math.max(0, ...latest.map((l) => l.updatedAt), wallet?.at ?? 0, fichas?.at ?? 0);
  const active: NavId = tab === "geral" ? "inicio" : tab === "financas" && finView !== "compras" ? finView : "mais";
  const visibleCrypto = cryptoSubs.filter((x) => !member || x.id === "carteira" || (x.id === "sinais" && canRobo));
  const icon = { carteira: <Bitcoin size={18} />, sinais: <Bot size={18} />, operacoes: <ArrowLeftRight size={18} /> } as const;
  const more: MoreItem[] = [
    ...visibleCrypto.map((x) => ({ id: x.id, label: x.id === "carteira" ? "Cripto: carteira" : x.label, icon: icon[x.id], active: tab === x.id, onClick: () => setTab(x.id) })),
    { id: "compras", label: "Lista de compras", icon: <ShoppingCart size={18} />, active: tab === "financas" && finView === "compras", onClick: () => goFin("compras") },
    { id: "ajuda", label: "Ajuda", icon: <CircleHelp size={18} />, active: tab === "ajuda", onClick: () => setTab("ajuda") },
    ...(role === "owner" && !demo && !support ? [{ id: "membros", label: "Membros", icon: <Users size={18} />, onClick: () => setShowAdmin(true) }] : []),
    ...(member && !support ? [{ id: "conta", label: "Minha conta", icon: <UserRound size={18} />, onClick: () => setShowAccount(true) }] : []),
  ];
  const who = (demo ? "Demo" : user.displayName || user.email || "?").trim();
  const accountItems = [
    ...(role === "owner" && !demo && !support ? [{ label: "Membros", onClick: () => setShowAdmin(true) }] : []),
    ...(member && !support ? [{ label: "Minha conta", onClick: () => setShowAccount(true) }] : []),
  ];

  const banners = <>
    <ScrollHints />
    {support && <p className="banner support-bar"><b>Modo suporte:</b> vendo a conta de {support.email}, só leitura, até {new Date(support.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.
      <button className="primary small-btn" onClick={exitSupport}>Sair do suporte</button></p>}
    {member && !support && (() => {
      const st = subStatus(until);
      if (until === null || (st.s !== "atrasado" && st.s !== "vence")) return null;
      return <p className={`banner sub-bar sub-${st.s}`}>{st.s === "atrasado"
        ? <>Sua assinatura venceu em {fmtBR(until)}. Renove para continuar usando.</>
        : <>Sua assinatura vence {st.dias === 0 ? "hoje" : `em ${st.dias} ${st.dias === 1 ? "dia" : "dias"}`} ({fmtBR(until)}).</>}</p>;
    })()}
    {error && <p className="banner error">{error}</p>}
    {notice && <p className="banner">{notice}</p>}
  </>;

  return (
    <>
      <Shell active={active} more={more} banners={banners}
        onNav={(id) => (id === "inicio" ? setTab("geral") : goFin(id))}
        onLaunch={support ? undefined : () => setLaunch(true)}
        subtitle={`finanças e cripto${updatedAt ? ` - dados ${ago(updatedAt)}` : ""}`}
        account={{ initial: who.slice(0, 1).toUpperCase(), label: `Conta de ${who}`, items: accountItems }}
        onSignOut={() => (demo ? undefined : signOut(auth()))}>
        {tab === "geral" && (
          <Overview member={member} cfg={eff} latest={latest} prices={prices} wallet={wallet} fichas={fichas} sync={cfg.lighter?.enabled ? sync : null} onTab={setTab}
            money={{ cfg, fin: finance, wallet: walletOk ? wallet : null, spend, debt, months, setup: gSetup, nwHist }}
            onFin={(s: FinSub | "loans" | "recv") => { try { localStorage.setItem("finSub", s); } catch { /* sem armazenamento */ } goFin(s === "lanc" ? "mes" : s === "compras" ? "compras" : "patrimonio"); }} />
        )}
        {inCrypto && (
          <div className="toolbar">
            <nav className="subtabs" role="tablist" aria-label="Cripto">
              {visibleCrypto.map((x) => (
                <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "pill on" : "pill"} onClick={() => setTab(x.id)}>{x.label}</button>
              ))}
            </nav>
            {!support && <div className="toolbar-actions">
              <button onClick={refresh} disabled={busy} className="primary small-btn" title={member ? "Carteiras e cotações" : "Sinais do robô, carteiras, fichas dos tokens e cotações"}>
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
        {tab === "financas" && <FinanceCard view={finView} onView={goFin} cfg={cfg} fin={finance} wallet={walletOk ? wallet : null} spend={spend} debt={debt} months={months} setup={gSetup}
          onChanged={() => { refreshFinance().then((p) => p.length && setError(p.join("; "))); }}
          onQuotes={support ? undefined : async () => { const p = await refreshFinance(); if (p.length) setError(p.join("; ")); else setNotice(`Cotações atualizadas às ${new Date().toLocaleTimeString("pt-BR")}.`); }} />}
        {tab === "carteira" && <WalletCard wallet={wallet} history={walletHistory} cfg={eff} latest={latest} />}
        {tab === "operacoes" && !member && (
          <>
            <TradeForm cfg={cfg} latest={latest} prices={prices} />
            <TradesTable trades={trades} />
          </>
        )}

        <p className="muted small footer">Ferramenta educacional, não é recomendação de investimento.{!member && <> O candle diário fecha às 21:00 (Brasília).
          Opere só na sua carteira (DEX); a Binance é usada apenas como fonte de preços.</>}</p>
      </Shell>
      <LaunchSheet open={launch} onClose={() => setLaunch(false)} months={months} setup={gSetup} invest={cfg.finance ?? []}
        onCards={() => { try { localStorage.setItem("finSub", "cards"); } catch { /* sem armazenamento */ } goFin("patrimonio"); }} />
      {showCfg && (
        <Modal onClose={() => setShowCfg(false)}>
          {member ? <MemberConfigForm cfg={cfg} onClose={() => setShowCfg(false)} /> : <ConfigForm cfg={cfg} onClose={() => setShowCfg(false)} />}
        </Modal>
      )}
      {showAdmin && <Modal onClose={() => setShowAdmin(false)}><MembersAdmin onClose={() => setShowAdmin(false)} onSupport={enterSupport} /></Modal>}
      {showAccount && user && <Modal onClose={() => setShowAccount(false)}><MyAccount user={user} subUntil={until} onClose={() => setShowAccount(false)} /></Modal>}
    </>
  );
}
