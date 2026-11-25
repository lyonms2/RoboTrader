"use client";
import { doc, setDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { GROUPS, compareCdi, dayBR, financeSummary, impliedCdiPct, irRate, tesouroOptions, type FinGroup, type FinRow, type Flow } from "@/lib/financeMath";
import type { AppConfig, FinanceDoc, FinItem, FinKind, WalletDoc } from "@/lib/types";
import { INVEST_CAT, goalStatus, type Goal, accountBalance, accountsOf, addMonths, dirOf, investFlows, monthLabel, monthOf, newId, todayBR, type Account, type Gasto, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import GastosCard, { guardWrite, AccountForm, AccountsPanel, FixoForm, monthSnapshot, saveSetup, PayableForm } from "./GastosCard";
import CardsLoans, { type CardsEntry } from "./CardsLoans";
import { ask, tell } from "./Dialog";

import Note from "./Note";
import { BalanceEq, FinBar } from "./OverviewBlocks";
export { NetWorthBlock } from "./OverviewBlocks";
import ExportData from "./ExportData";
import ShoppingList from "./ShoppingList";
import { Badge, Button, Card as UiCard, EmptyState, Fold, InfoTip, List, ListRow, Money, Progress, Section, Segmented, Sheet, Stat, Stats } from "./ui";
import { Bitcoin, CalendarClock, CreditCard, House, Landmark, PiggyBank, Plus, RefreshCw, UserRound } from "lucide-react";
// membro: dados em users/{uid}/ (o dono exporta tambem as operacoes manuais)
const isMemberBase = () => P("").startsWith("users/");
// Resumo = ver como esta; Lancamentos = unico lugar onde o dinheiro se move; Contas e bens = unico lugar com saldos e cadastros
// O resumo (patrimonio, mes, proximos pagamentos, evolucao) fica na Visao geral
export type Sub = "lanc" | "invest" | "cards" | "loans" | "recv" | "bens" | "compras";
const OLD_SUB: Record<string, Sub> = { gastos: "lanc", dividas: "bens", resumo: "lanc" };

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$\u00a0${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}R$\u00a0${fmt(Math.abs(v))}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const short = (n: string) => (n.length > 48 ? `${n.slice(0, 46)}...` : n);
const pctS = (v: number, d = 1) => `${fmt(v * 100, d)}%`;
// Numero no formato brasileiro: "5.000,50" e "5.000" (milhar) ou "0,35" / "0.35" (decimal)
export function parse(s: string) {
  let t = s.replace(/[\sR$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t) || 0;
}
const KINDS: { key: FinKind; label: string; hint: string }[] = [
  { key: "caixa", label: "Conta / cofrinho", hint: "saldo + % do CDI: o rendimento até hoje e estimado sozinho" },
  { key: "tesouro", label: "Tesouro Direto", hint: "título + quantidade: o preço do dia vem do Tesouro" },
  { key: "acao", label: "Ação / FII / ETF", hint: "código + quantidade: cotação e proventos automáticos" },
  { key: "outro", label: "Outro", hint: "previdência, poupança, imóvel... valor digitado à mão" },
];

// Aba Financas: tudo num lugar so (cripto das carteiras + reserva, Tesouro, acoes/FIIs e outros), em reais
export type FinView = "mes" | "patrimonio" | "compras";
const PAT_SUBS: { id: Sub; label: string }[] = [
  { id: "bens", label: "Contas" }, { id: "invest", label: "Investimentos" }, { id: "cards", label: "Cartões" }, { id: "loans", label: "Empréstimos" }, { id: "recv", label: "A receber" },
];
export default function FinanceCard({ cfg, fin, wallet, onChanged, onQuotes, spend, debt, months, setup, view, onView }: {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; onChanged: () => void; onQuotes?: () => Promise<void>;
  spend: { value: number; months: number } | null; // media de gastos
  debt: { total: number; loans: number; cards: number; recv: number };
  months: Record<string, MonthDoc>; setup: GastosSetup;
  view: FinView; onView: (v: FinView) => void; // Mes = Lancamentos; Patrimonio = contas e bens, investimentos, cartoes; Lista de compras
}) {
  // Parte do Patrimonio aberta, lembrada neste navegador
  const [patSub, setSubState] = useState<Sub>(() => {
    try {
      const raw = localStorage.getItem("finSub") ?? "";
      const v = (OLD_SUB[raw] ?? raw) as Sub;
      return PAT_SUBS.some((x) => x.id === v) ? v : "bens";
    } catch {
      return "bens";
    }
  });
  const sub: Sub = view === "mes" ? "lanc" : view === "compras" ? "compras" : patSub;
  const setSub = (v: Sub) => {
    if (PAT_SUBS.some((x) => x.id === v)) {
      setSubState(v);
      try { localStorage.setItem("finSub", v); } catch { /* sem armazenamento */ }
      if (view !== "patrimonio") onView("patrimonio");
    } else if (v === "lanc" || v === "compras") {
      const to: FinView = v === "lanc" ? "mes" : "compras";
      if (view !== to) onView(to);
    }
    window.scrollTo({ top: 0 });
  };
  const [entry, setEntry] = useState<{ type: EntryType; id: string | null } | null>(null); // folha de cadastro/alteracao aberta
  // "loans" (aviso de parcela atrasada na Visao geral) abre direto em Emprestimos
  const [cardsEntry, setCardsEntry] = useState<CardsEntry>({ type: "compra", id: null });
  // investimento aberto para incluir/alterar na sub-aba Investimentos (undefined = fechado, null = novo)
  const [invEdit, setInvEdit] = useState<string | null | undefined>(() => {
    // aviso do Inicio ("confira o saldo do cofrinho"): abre a ficha dele uma vez
    try { const id = localStorage.getItem("invOpen"); if (id) { localStorage.removeItem("invOpen"); return id; } } catch { /* sem armazenamento */ }
    return undefined;
  });
  const [bemEdit, setBemEdit] = useState<string | null | undefined>(undefined); // bens tambem se cadastram em Investimentos
  // cartao e emprestimo se lancam em Cartoes e emprestimos; investimento em Investimentos; o resto em Lancamentos
  const goEdit = (type: EntryType | "card" | "loan", id: string | null) => {
    if (type === "card" || type === "loan") { setCardsEntry({ type, id }); setSub(type === "card" ? "cards" : "loans"); return; }
    if (type === "inv") { setInvEdit(id); setSub("invest"); return; }
    if (type === "bem") { setBemEdit(id); setSub("invest"); return; }
    setEntry({ type, id });
  };
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));

  async function save(list: FinItem[], fetchQuotes: boolean) {
    guardWrite();
    await setDoc(doc(db(), P("config/main")), { finance: JSON.parse(JSON.stringify(list)) }, { merge: true });
    if (fetchQuotes) onChanged();
  }
  const upsert = async (it0: FinItem) => {
    // o formulario nao conhece as conferencias, o bruto/liquido e o "aplicado desde" do cofrinho: mantem os que ja havia
    const prev = items.find((x) => x.id === it0.id);
    const keep = prev && prev.kind === it0.kind && it0.kind === "caixa" ? { ...(prev.checks ? { checks: prev.checks } : {}), ...(prev.shows ? { shows: prev.shows } : {}), ...(prev.since ? { since: prev.since } : {}) } : {};
    const it = { ...keep, ...it0 };
    const list = items.some((x) => x.id === it.id) ? items.map((x) => (x.id === it.id ? it : x)) : [...items, it];
    if (it.kind === "bem") setBemEdit(undefined); else setInvEdit(undefined);
    await save(list, it.kind === "acao" || it.kind === "tesouro");
  };
  // conferir cofrinho: grava sem fechar a folha
  const saveItem = (it: FinItem) => save(items.map((x) => (x.id === it.id ? it : x)), false);
  const remove = async (it: FinItem) => {
    if (!await ask(`Remover "${it.name}" da lista? (só tira do site, não mexe no investimento)`)) return;
    await save(items.filter((x) => x.id !== it.id), false);
    if (it.kind === "bem") setBemEdit(undefined); else setInvEdit(undefined);
  };

  const order = GROUPS.map((g) => g.key);
  const rows = [...s.rows].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (b.value ?? 0) - (a.value ?? 0));
  const mon = monthSnapshot(months, setup);
  // Contas e bens: so o que esta nas abas de Financas (contas, investimentos, bens, a receber, dividas). A cripto fica na aba
  // Cripto; a Visao geral soma tudo
  const crypto = s.byGroup.cripto + s.byGroup.dolar;
  const contas = s.byGroup.conta;
  const investido = s.total - crypto - contas - s.bens;
  const invRows = rows.filter((r) => r.item.kind !== "bem");
  const invTot = invRows.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.value ?? 0), 0);
  const invMonthly = invRows.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.monthly ?? 0), 0);
  const bemRows = rows.filter((r) => r.item.kind === "bem");

  // so o Patrimonio tem partes; Mes e Lista de compras sao uma tela so
  // Tem / Deve / Liquido igual ao Inicio (com a cripto); a conta completa no "i"
  const tem = s.total + debt.recv;
  const nav = view !== "patrimonio" ? null : (<>
    <div className="pat-head">
      <div className="pat-title"><h1>Patrimônio</h1>
        <InfoTip label="Como é calculado"><b>O que você tem − o que deve</b>
          <BalanceEq contas={contas} investido={investido} crypto={crypto} bens={s.bens} recv={debt.recv} cards={debt.cards} loans={debt.loans} people={debt.total - debt.cards - debt.loans} />
          {s.bens > 0 && <span className="home-tip-line">Sem os bens: {brl(tem - debt.total - s.bens)}</span>}</InfoTip></div>
      <div className="pat-bal">
        <div><span>Tem</span><Money value={tem} size="md" /></div>
        <div><span>Deve</span><Money value={debt.total} size="md" tone={debt.total > 0 ? "neg" : undefined} /></div>
        <div><span>Líquido</span><Money value={tem - debt.total} size="md" tone={tem - debt.total < 0 ? "neg" : "brand"} /></div>
      </div>
    </div>
    <div className="pat-tabs" role="tablist" aria-label="Partes do patrimônio">
      {PAT_SUBS.map((x) => <button key={x.id} type="button" role="tab" aria-selected={patSub === x.id} className={patSub === x.id ? "pat-tab on" : "pat-tab"} onClick={() => setSub(x.id)}>{x.label}</button>)}
    </div>
  </>);
  const entrySheet = <EntrySheet entry={entry} onClose={() => setEntry(null)} months={months} setup={setup} />;
  if (sub === "compras") return <>{nav}<ShoppingList months={months} setup={setup} ipca12m={fin?.ipca12m ?? null} />{entrySheet}</>;
  if (sub === "cards" || sub === "loans" || sub === "recv") return <>{nav}<CardsLoans key={sub} part={sub} months={months} setup={setup} invest={items} entry={cardsEntry} setEntry={setCardsEntry} />{entrySheet}</>;
  if (sub === "invest") return (
    <>{nav}<InvestPart items={items} rows={rows} fin={fin} months={months} reserve={s.reserve} reserveMonths={s.reserveMonths}
      setup={setup} onQuotes={onQuotes} onCheck={saveItem} edit={invEdit} setEdit={setInvEdit} bemEdit={bemEdit} setBemEdit={setBemEdit} bensTotal={s.bens} onSave={upsert} onRemove={remove} onLanc={() => setSub("lanc")} />{entrySheet}</>
  );
  if (sub === "lanc") return <>{nav}<GastosCard months={months} setup={setup} invest={items} onBens={() => setSub("bens")} onCard={(id) => goEdit("card", id)} onFixo={(id, kind) => setEntry({ type: kind, id })}
    onCardBuy={(id, d) => { setCardsEntry({ type: "compra", id, d }); setSub("cards"); }} />{entrySheet}</>;

  return (
    <>
      {nav}
      {sub === "bens" && <div className="pat-part">
      <Section title="Contas">
        <UiCard><AccountsPanel months={months} setup={setup} m={mon.m} onEdit={(id) => goEdit("conta", id)} /></UiCard>
      </Section>

      {/* o resto do patrimonio: so atalhos (cada coisa se cadastra num lugar so) */}
      <Section title="O resto do patrimônio">
        <List>
          <ListRow icon={<PiggyBank size={18} />} iconTone="pos" title="Investimentos" sub={invMonthly > 0 ? `rende ~${brl(invMonthly)} por mês` : `${invRows.length} ${invRows.length === 1 ? "cadastrado" : "cadastrados"}`}
            value={brl(invTot)} onClick={() => setSub("invest")} />
          <ListRow icon={<House size={18} />} iconTone="info" title="Imóveis e veículos" sub={bemRows.length ? bemRows.map((r) => r.item.name).join(", ") : "nenhum cadastrado"}
            value={bemRows.length ? brl(s.bens) : undefined} onClick={() => (bemRows.length ? setSub("invest") : goEdit("bem", null))} />
          {crypto > 0 && <ListRow icon={<Bitcoin size={18} />} iconTone="brand" title="Cripto" sub="carteiras (em Mais > Cripto)" value={brl(crypto)} />}
          <ListRow icon={<UserRound size={18} />} iconTone="pos" title="A receber" sub={(setup.recvs ?? []).length ? `${(setup.recvs ?? []).length} ${(setup.recvs ?? []).length === 1 ? "cadastrado" : "cadastrados"}` : "ninguém te deve"}
            value={debt.recv > 0 ? brl(debt.recv) : undefined} onClick={() => setSub("recv")} />
          <ListRow icon={<CreditCard size={18} />} iconTone="neg" title="Cartões" sub="faturas a pagar e parcelas futuras" value={debt.cards > 0 ? <span className="neg">−{brl(debt.cards)}</span> : undefined} onClick={() => setSub("cards")} />
          <ListRow icon={<Landmark size={18} />} iconTone="neg" title="Empréstimos" sub="saldo devedor" value={debt.loans > 0 ? <span className="neg">−{brl(debt.loans)}</span> : undefined} onClick={() => setSub("loans")} />
          <ListRow icon={<CalendarClock size={18} />} iconTone="warn" title="Contas a pagar e entradas fixas" sub="ficam em Mês > Contas do mês" onClick={() => setSub("lanc")} />
        </List>
      </Section>

      <Section title="Onde está o dinheiro">
        <UiCard>
          <FinBar byGroup={s.byGroup} />
          <p className="mes-line">A conta completa (o que você tem − o que deve) fica no &quot;i&quot; do topo.</p>
        </UiCard>
      </Section>

      <Fold title="Seus dados">
        <UiCard><ExportData owner={!isMemberBase()} /></UiCard>
      </Fold>
      </div>}
      {entrySheet}
    </>
  );
}

// ---------- sub-aba Investimentos: cadastro, carteira, aportes/resgates e proventos ----------
function InvestPart({ items, rows, fin, months, setup, reserve, reserveMonths, onQuotes, onCheck, edit, setEdit, bemEdit, setBemEdit, bensTotal, onSave, onRemove, onLanc }: {
  items: FinItem[]; rows: FinRow[]; fin: FinanceDoc | null; months: Record<string, MonthDoc>;
  setup: GastosSetup; reserve: number; reserveMonths: number | null; onQuotes?: () => Promise<void>; onCheck: (it: FinItem) => Promise<void>;
  edit: string | null | undefined; setEdit: (id: string | null | undefined) => void;
  bemEdit: string | null | undefined; setBemEdit: (id: string | null | undefined) => void; bensTotal: number;
  onSave: (it: FinItem) => void; onRemove: (it: FinItem) => void; onLanc: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (edit !== undefined) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [edit]);
  const bemPanel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bemEdit !== undefined) bemPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [bemEdit]);
  const bens = rows.filter((r) => r.item.kind === "bem");
  const curBem = bemEdit ? items.find((i) => i.id === bemEdit) ?? null : null;
  const [allMoves, setAllMoves] = useState(false);
  const [qBusy, setQBusy] = useState(false);
  const inv = rows.filter((r) => r.item.kind !== "bem");
  const live = inv.filter((r) => !r.item.ignore);
  const total = live.reduce((t, r) => t + (r.value ?? 0), 0);
  const withCost = live.filter((r) => r.cost !== null && r.value !== null);
  const cost = withCost.reduce((t, r) => t + r.cost!, 0);
  const gain = withCost.reduce((t, r) => t + r.value! - r.cost!, 0);
  const monthly = live.reduce((t, r) => t + (r.monthly ?? 0), 0);
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g.key, 0])) as Record<FinGroup, number>;
  for (const r of live) byGroup[r.group] += r.value ?? 0;
  // Aportes e resgates: lancamentos da categoria Investimento nos ultimos 12 meses
  const from = addMonths(monthOf(todayBR()), -11);
  const moves = Object.entries(months).filter(([m]) => m >= from).flatMap(([, md]) => md.items.filter((g) => g.cat === INVEST_CAT))
    .sort((x, y) => y.d.localeCompare(x.d));
  const put = moves.filter((g) => dirOf(g) < 0).reduce((t, g) => t + g.v, 0);
  const took = moves.filter((g) => dirOf(g) > 0).reduce((t, g) => t + g.v, 0);
  const unlinked = moves.filter((g) => !g.inv).length;
  const nameOf = (id?: string) => items.find((i) => i.id === id)?.name;
  const cur = edit ? items.find((i) => i.id === edit) ?? null : null;
  const shown = allMoves ? moves : moves.slice(0, 8);
  const invFlows = investFlows(months);
  // cofrinho: ha quantos dias foi conferido (ou o saldo informado) e a diferenca da ultima conferencia
  const checkedInfo = (r: FinRow) => {
    if (!r.calc) return null;
    const dd = Math.floor((Date.parse(`${dayBR(Date.now())}T12:00:00Z`) - Date.parse(`${r.calc.checkedDay}T12:00:00Z`)) / 86_400_000);
    const txt = dd <= 0 ? "conferido hoje" : `conferido há ${dd} ${dd === 1 ? "dia" : "dias"}`;
    return r.calc.diff !== null && Math.abs(r.calc.diff) >= 1 ? `${txt} (diferença de ${brl(Math.abs(r.calc.diff))})` : txt;
  };
  return (
    <div className="pat-part">
      <div className="pat-inv-acts">
        <Button variant="primary" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEdit(null)}>Investimento</Button>
        {onQuotes && <Button size="sm" icon={<RefreshCw size={15} aria-hidden="true" />} disabled={qBusy} title="Ações, FIIs, Tesouro, CDI, IPCA e dólar"
          onClick={async () => { setQBusy(true); try { await onQuotes(); } finally { setQBusy(false); } }}>{qBusy ? "Atualizando..." : "Atualizar cotações"}</Button>}
        {fin && <span className="mes-line">cotações de {new Date(fin.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      <Stats scroll cols={5}>
        <Stat label="Investido hoje" value={<Money value={total} size="md" />} hint={`${live.length} ${live.length === 1 ? "investimento" : "investimentos"}, fora cripto`} />
        <Stat label="Lucro / prejuízo" value={cost > 0 ? <Money value={gain} size="md" tone="auto" signed /> : "-"} hint={cost > 0 ? `${pctS(gain / cost)} sobre ${brl(cost)}` : "informe os preços médios"} />
        <Stat label="Rende por mês" value={<Money value={monthly} size="md" />} hint={monthly > 0 ? `~${brl(monthly * 12)} por ano` : "juros + proventos"} />
        <Stat label="Reserva" value={<Money value={reserve} size="md" />} hint={reserveMonths !== null ? `${fmt(reserveMonths, 1)} meses de gastos` : "marque \"reserva\" no investimento"} />
        <Stat label="Guardou em 12 meses" value={moves.length ? <Money value={put - took} size="md" tone="auto" signed /> : "-"} hint={moves.length ? `aplicou ${brl(put)}` : "aportes do extrato"} />
      </Stats>

      <Section title="Sua carteira" action={<span>{brl(total)}</span>}
        info={<>Automático: cotação e proventos, preço do Tesouro (1 vez por dia), CDI, IPCA e dólar (Banco Central). À mão: quantidades, saldo do cofrinho e
          preços médios, porque bancos e a B3 não têm API aberta para ler sua posição. Valores brutos, antes de IR e taxas.</>}>
        {inv.length ? GROUPS.filter((g) => inv.some((r) => r.group === g.key)).map((g) => {
          const gr = inv.filter((r) => r.group === g.key).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
          const gv = gr.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.value ?? 0), 0);
          return (
            <div key={g.key} className="pat-grp">
              <div className="pat-grp-head"><span><i className={`dot g-${g.key}`} aria-hidden="true" />{g.label}</span>
                <span>{brl(gv)}{total > 0 ? ` · ${pctS(gv / total, 0)}` : ""}</span></div>
              <Progress value={total > 0 ? gv / total : 0} tone="info" label={`${g.label}: parte da carteira`} />
              <List>
                {gr.map((r) => {
                  const gn = r.cost !== null && r.value !== null ? r.value - r.cost : null;
                  return (
                    <ListRow key={r.item.id} onClick={() => setEdit(r.item.id)} chevron={false} muted={!!r.item.ignore}
                      title={<>{r.item.name}{r.item.reserva && <Badge tone="info">reserva</Badge>}</>}
                      sub={r.problem ? <span className="warn">{r.problem}</span> : [r.kindLabel, r.yieldYear !== null ? `${pctS(r.yieldYear, 1)} ao ano` : null, r.monthly ? `rende ~${brl(r.monthly)}/mês` : null, checkedInfo(r)].filter(Boolean).join(" · ")}
                      value={<span className="pat-inv-v"><b>{r.value !== null ? brl(r.value) : "-"}</b>{gn !== null && Math.abs(gn) >= 0.01 && <small className={pnlClass(gn)}>{signed(gn)}</small>}</span>} />
                  );
                })}
              </List>
            </div>
          );
        }) : <UiCard><EmptyState title="Nenhum investimento" text="Cofrinho, Tesouro, ações, FIIs ou outros: cadastre e o site acompanha o rendimento."
          action={<Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEdit(null)}>Cadastrar investimento</Button>} /></UiCard>}
      </Section>

      <Sheet open={edit !== undefined} onClose={() => setEdit(undefined)} title={cur ? `Alterar ${cur.name}` : "Novo investimento"} width={640}>
        {edit !== undefined && <div className="ls-form">
          {cur?.kind === "caixa" && <CheckBank item={cur} row={rows.find((r) => r.item.id === cur.id)} fin={fin} flows={invFlows[cur.id] ?? []} months={months} onCheck={onCheck} />}
          <ItemForm key={`${edit ?? "novo"}-${cur?.balanceAt ?? ""}-${cur?.cdiPct ?? ""}`} initial={cur} fin={fin} onSave={onSave} onCancel={() => setEdit(undefined)} />
          {cur && <Button variant="danger" size="sm" className="pay-remove" onClick={() => onRemove(cur)}>Remover este investimento</Button>}
        </div>}
      </Sheet>

      <CdiCard rows={rows} fin={fin} />

      <Fold title="Aportes e resgates" meta={moves.length ? `guardou ${signed(put - took)}` : "últimos 12 meses"} count={unlinked || undefined} countTone="warn">
      <section className="card">
        <div className="card-head"><h2>Últimos 12 meses</h2><span className="muted small"><button className="link" onClick={onLanc}>ver lançamentos &rsaquo;</button></span></div>
        {moves.length > 0 && (() => {
          const per = (out: boolean) => {
            const by: Record<string, number> = {};
            for (const g of moves) if ((dirOf(g) < 0) === out) { const k = nameOf(g.inv) ?? "sem destino"; by[k] = (by[k] ?? 0) + g.v; }
            return Object.entries(by).sort((a, b) => b[1] - a[1]);
          };
          const ap = per(true), rs = per(false);
          return (
            <div className="flow small">
              <div className="flow-col">
                <div className="flow-h"><span>Aplicou (saiu da conta)</span><b className="v-move">{brl(put)}</b></div>
                {ap.length ? ap.map(([k, v]) => <div key={k} className="flow-r"><span className={k === "sem destino" ? "warn" : ""}>{k}</span><span>{brl(v)}</span></div>)
                  : <div className="flow-r muted"><span>nada aplicado</span></div>}
              </div>
              <div className="flow-col">
                <div className="flow-h"><span>Resgatou (voltou para a conta)</span><b className="v-move">{brl(took)}</b></div>
                {rs.length ? rs.map(([k, v]) => <div key={k} className="flow-r"><span className={k === "sem destino" ? "warn" : ""}>{k}</span><span>{brl(v)}</span></div>)
                  : <div className="flow-r muted"><span>nada resgatado</span></div>}
              </div>
              <div className="flow-net"><span>Guardou no período</span><b className={put - took >= 0 ? "pos" : "v-out"}>{put - took >= 0 ? "+" : "-"}{brl(Math.abs(put - took))}</b>
                <small className="muted">{put - took >= 0 ? "aplicou mais do que resgatou" : "resgatou mais do que aplicou"}</small></div>
            </div>
          );
        })()}
        {moves.length ? (
          <div className="table-scroll">
            <table className="stack moves">
              <thead><tr><th>Data</th><th>Descrição</th><th>Investimento</th><th>Movimento</th></tr></thead>
              <tbody>
                {shown.map((g: Gasto) => {
                  const out = dirOf(g) < 0;
                  return (
                    <tr key={g.id}>
                      <td data-label="Data">{dm(g.d)}/{g.d.slice(2, 4)}</td>
                      <td data-label="Descrição">{g.desc}</td>
                      <td data-label="Investimento">{nameOf(g.inv) ?? <span className="warn">sem destino</span>}</td>
                      <td data-label="Movimento" className="v-move">{out ? "aplicou " : "resgatou "}<b>{brl(g.v)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted small">Nenhum aporte ou resgate nos últimos 12 meses.</p>}
        {moves.length > 8 && <button className="link" onClick={() => setAllMoves(!allMoves)}>{allMoves ? "ver menos" : `ver todos (${moves.length})`}</button>}
        {unlinked > 0 && <p className="warn small">{unlinked} {unlinked === 1 ? "movimento está" : "movimentos estão"} sem destino: escolha o investimento em Lançamentos.</p>}
        <Note>
          Aportes e resgates vêm do extrato (categoria Investimento, em Lançamentos). Ligados a um cofrinho ou &quot;outro&quot;, eles somam e
          descontam o saldo sozinhos. Tesouro e ações: atualize a quantidade aqui depois de comprar ou vender.
        </Note>
      </section>
      </Fold>

      <Dividends rows={rows} fin={fin} />

      <Fold title="Metas" count={(setup.goals ?? []).length || undefined} countTone="neutral"><GoalsCard setup={setup} rows={rows} /></Fold>

      <Fold title="Imóveis e veículos" meta={bens.length ? brl(bensTotal) : "nenhum"} defaultOpen={bemEdit !== undefined || bens.length > 0}>
      <section className="card">
        <div className="card-head"><h2>Bens</h2><span className="muted small"><b>{brl(bensTotal)}</b><button className="ghost small-btn" onClick={() => setBemEdit(null)}>+ novo bem</button></span></div>
        <Sheet open={bemEdit !== undefined} onClose={() => setBemEdit(undefined)} title={curBem ? `Alterar ${curBem.name}` : "Novo bem"} width={640}>
          {bemEdit !== undefined && <div className="ls-form" ref={bemPanel}>
            <ItemForm key={bemEdit ?? "novo-bem"} only="bem" initial={curBem} fin={fin} onSave={onSave} onCancel={() => setBemEdit(undefined)} />
            {curBem && <Button variant="danger" size="sm" className="pay-remove" onClick={() => onRemove(curBem)}>Remover este bem</Button>}
          </div>}
        </Sheet>
        {bens.length ? (
          <ul className="asset-list">
            {[...bens].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map((r) => {
              const dif = r.cost !== null && r.value !== null ? r.value - r.cost : null;
              return (
                <li key={r.item.id} className={r.item.ignore ? "off" : ""}>
                  <span className="a-name"><b>{r.item.name}</b>
                    <small className="muted">{r.kindLabel}{r.item.ignore ? " - fora do patrimônio" : ""}{r.note ? ` - ${r.note}` : ""}</small></span>
                  <span className="a-paid small">{r.cost !== null ? <>pagou {brl(r.cost)}{dif !== null && <small className={pnlClass(dif)}>{signed(dif)}</small>}</> : <span className="muted">-</span>}</span>
                  <span className="a-v"><b>{r.value !== null ? brl(r.value) : "-"}</b></span>
                  <button className="link" onClick={() => setBemEdit(r.item.id)}>alterar</button>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted small">Nenhum bem cadastrado.</p>}
        <Note>Imóveis, terrenos e veículos: entram no patrimônio &quot;com bens&quot;, separados do financeiro, e não somam no
          &quot;Investido hoje&quot; acima. O valor anda sozinho se você informar quanto valoriza ou deprecia por ano.</Note>
      </section>
      </Fold>
    </div>
  );
}


// Formulario de inclusao/edicao: os campos mudam com o tipo
function ItemForm({ initial, fin, onSave, onCancel, only }: {
  initial: FinItem | null; fin: FinanceDoc | null; onSave: (it: FinItem) => void; onCancel: () => void; only?: FinKind;
}) {
  const [kind, setKind] = useState<FinKind>(only ?? initial?.kind ?? "caixa");
  const [bemType, setBemType] = useState<NonNullable<FinItem["bemType"]>>(initial?.bemType ?? "imovel");
  const [paid, setPaid] = useState(initial?.paid !== undefined ? String(initial.paid).replace(".", ",") : "");
  const [rate, setRate] = useState(initial?.rate !== undefined ? String(initial.rate).replace(".", ",") : "");
  const [counts, setCounts] = useState(!initial?.ignore);
  const [name, setName] = useState(initial?.name ?? "");
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [qty, setQty] = useState(initial?.qty !== undefined ? String(initial.qty).replace(".", ",") : "");
  const [avg, setAvg] = useState(initial?.avg !== undefined ? String(initial.avg).replace(".", ",") : "");
  const [since, setSince] = useState(initial?.since ? new Date(initial.since - 3 * 3_600_000).toISOString().slice(0, 10) : "");
  const sinceF = since ? { since: Date.parse(`${since}T12:00:00-03:00`) } : {};
  const [balance, setBalance] = useState(initial?.balance !== undefined ? String(initial.balance).replace(".", ",") : "");
  const [balanceAt, setBalanceAt] = useState(new Date(initial?.balanceAt ?? Date.now() - 3 * 3_600_000).toISOString().slice(0, 10));
  const [dateTouched, setDateTouched] = useState(false);
  const [cdiPct, setCdiPct] = useState(String(initial?.cdiPct ?? 100));
  const [hasPart2, setHasPart2] = useState(!!initial?.part2);
  const [p2v, setP2v] = useState(initial?.part2 ? String(initial.part2.v).replace(".", ",") : "");
  const [p2pct, setP2pct] = useState(initial?.part2 ? String(initial.part2.pct).replace(".", ",") : "");
  const [value, setValue] = useState(initial?.value !== undefined ? String(initial.value).replace(".", ",") : "");
  const [reserva, setReserva] = useState(initial?.reserva ?? (initial ? false : true));
  const [err, setErr] = useState("");
  // Mais comuns primeiro, agrupados por tipo e em ordem de vencimento
  const rank = (id: string) => ["Tesouro Selic|", "Tesouro Prefixado|", "Tesouro IPCA+|", "Tesouro Prefixado com", "Tesouro IPCA+ com", "Tesouro Renda", "Tesouro Educa"]
    .findIndex((p) => id.startsWith(p)) + 1 || 99;
  const opts = tesouroOptions(fin).sort((a, b) => rank(a.id) - rank(b.id) || a.id.split("|")[0].localeCompare(b.id.split("|")[0]) || a.sort.localeCompare(b.sort));
  const groups = [...new Set(opts.map((o) => o.id.split("|")[0]))];
  const missing = title && !opts.some((o) => o.id === title);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = initial?.id ?? Math.random().toString(36).slice(2, 10);
    const base = { id, kind };
    let it: FinItem;
    if (kind === "caixa") {
      if (!(parse(balance) >= 0) || !balance) return setErr("Informe o saldo.");
      const part2 = hasPart2 && parse(p2v) > 0 ? { v: parse(p2v), pct: parse(p2pct) } : null;
      if (part2 && !(part2.pct > 0)) return setErr("Informe o % do CDI da parte com outra taxa.");
      if (part2 && part2.v > parse(balance)) return setErr("A parte com outra taxa não pode ser maior que o saldo total.");
      // Mudou o saldo e nao mexeu na data: e o saldo de hoje (senao o site somaria de novo o rendimento desde a data antiga)
      const changed = parse(balance) !== initial?.balance || (part2?.v ?? 0) !== (initial?.part2?.v ?? 0);
      const day = initial?.kind === "caixa" && changed && !dateTouched
        ? new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10) : balanceAt;
      it = { ...base, name: name.trim() || "Cofrinho", balance: parse(balance), balanceAt: Date.parse(`${day}T12:00:00-03:00`),
        cdiPct: parse(cdiPct) || 100, reserva, ...(part2 ? { part2 } : {}) };
    } else if (kind === "tesouro") {
      if (!title) return setErr("Escolha o título.");
      if (!(parse(qty) > 0)) return setErr("Informe a quantidade de títulos (ex.: 0,35).");
      it = { ...base, name: title.replace("|", " ").replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3"), title, qty: parse(qty), reserva,
        ...(parse(avg) > 0 ? { avg: parse(avg) } : {}), ...sinceF };
    } else if (kind === "acao") {
      const tk = ticker.trim().toUpperCase().replace(/\.SA$/, "");
      if (!/^[A-Z0-9]{4,7}$/.test(tk)) return setErr("Código inválido (ex.: TAEE11, ITSA4, MXRF11, IVVB11).");
      if (!(parse(qty) > 0)) return setErr("Informe a quantidade.");
      it = { ...base, name: tk, ticker: tk, qty: parse(qty), ...(parse(avg) > 0 ? { avg: parse(avg) } : {}), ...sinceF };
    } else if (kind === "bem") {
      if (!name.trim()) return setErr("De um nome (ex.: Apartamento, Terreno Criciúma, Carro).");
      if (!(parse(value) > 0)) return setErr("Informe o valor estimado de hoje.");
      const r = rate.trim() ? Number(rate.replace(/\s/g, "").replace(",", ".").replace(/[\u2212]/g, "-")) : NaN;
      // mantem a data do valor se ele nao mudou (para a depreciacao seguir contando)
      const valueAt = initial?.kind === "bem" && initial.value === parse(value) && initial.valueAt ? initial.valueAt : Date.now();
      it = { ...base, name: name.trim(), bemType, value: parse(value), valueAt, ...(parse(paid) > 0 ? { paid: parse(paid) } : {}),
        ...(Number.isFinite(r) && r !== 0 ? { rate: r } : {}), ...(counts ? {} : { ignore: true }) };
    } else {
      if (!name.trim()) return setErr("De um nome (ex.: Previdência, Poupança).");
      const valueAt = initial?.kind === "outro" && initial.value === parse(value) && initial.valueAt ? initial.valueAt : Date.now();
      it = { ...base, name: name.trim(), value: parse(value), valueAt, reserva };
    }
    onSave(it);
  };

  return (
    <form className="fin-form" onSubmit={submit}>
      {!only && <div className="kind-pick" role="radiogroup" aria-label="Tipo">
        {KINDS.map((k) => (
          <button type="button" key={k.key} role="radio" aria-checked={kind === k.key} className={kind === k.key ? "pill on" : "pill"}
            onClick={() => { setKind(k.key); setErr(""); }} disabled={!!initial && initial.kind !== k.key}>{k.label}</button>
        ))}
      </div>}
      {kind !== "bem" && <p className="muted small">{KINDS.find((k) => k.key === kind)?.hint}</p>}
      {kind === "bem" && <p className="muted small">Imóvel, terreno, veículo: entra no patrimônio &quot;com bens&quot;, separado do patrimônio financeiro.</p>}
      <div className="row wrapline">
        {(kind === "caixa" || kind === "outro") && (
          <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "caixa" ? "Cofrinho do banco" : "Previdência"} /></label>
        )}
        {kind === "caixa" && (
          <>
            <label>{hasPart2 ? "Saldo total hoje (R$)" : "Saldo hoje (R$)"}<input value={balance} inputMode="decimal" onChange={(e) => setBalance(e.target.value)} placeholder="5.000,00" /></label>
            <label>Data do saldo<input type="date" value={balanceAt} onChange={(e) => { setBalanceAt(e.target.value); setDateTouched(true); }} /></label>
            <label>{hasPart2 ? "% do CDI do resto" : "% do CDI"}<input value={cdiPct} inputMode="decimal" onChange={(e) => setCdiPct(e.target.value)} /></label>
            <label className="check full"><input type="checkbox" checked={hasPart2} onChange={(e) => setHasPart2(e.target.checked)} />
              Uma parte do saldo rende outra taxa (ex.: PicPay 120% numa parte e 102% no resto)</label>
            {hasPart2 && (
              <>
                <label>Valor nessa outra taxa (R$)<input value={p2v} inputMode="decimal" onChange={(e) => setP2v(e.target.value)} placeholder="641,22" /></label>
                <label>% do CDI dessa parte<input value={p2pct} inputMode="decimal" onChange={(e) => setP2pct(e.target.value)} placeholder="120" /></label>
              </>
            )}
            <Note>Depósitos e resgates lançados em Lançamentos (categoria Investimento) depois dessa data somam
              e descontam sozinhos. Ao mudar o saldo, a data vira hoje sozinha (a menos que você escolha outra).</Note>
            <Note>Imposto: o site calcula o rendimento bruto, antes do IR. Se o app do banco mostra o valor já sem IR
              (comum no Mercado Pago), o site fica um pouco acima. Para chegar perto, baixe o % do CDI: com 100% do CDI, use ~78% nos
              primeiros 6 meses, ~80% até 1 ano, ~83% até 2 anos e ~85% depois (IR de 22,5%, 20%, 17,5% e 15% sobre o rendimento).</Note>
          </>
        )}
        {kind === "tesouro" && (
          <>
            <label className="grow">Título
              <select value={title} onChange={(e) => setTitle(e.target.value)}>
                <option value="">{opts.length ? "escolha..." : "lista carrega no Atualizar cotações"}</option>
                {missing && <option value={title}>{title.replace("|", " ")}</option>}
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {opts.filter((o) => o.id.split("|")[0] === g).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Quantidade de títulos<input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} placeholder="0,35" /></label>
            <label>Preço médio por título (R$, opcional)<input value={avg} inputMode="decimal" onChange={(e) => setAvg(e.target.value)} /></label>
            <label>Data da compra (opcional)<input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
            <p className="muted small full">Com preço médio e data da compra, o site compara o resultado com o CDI. Comprou em várias datas? Use a da primeira compra.</p>
          </>
        )}
        {kind === "acao" && (
          <>
            <label>Código<input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="TAEE11" autoCapitalize="characters" /></label>
            <label>Quantidade<input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} /></label>
            <label>Preço médio (R$, opcional)<input value={avg} inputMode="decimal" onChange={(e) => setAvg(e.target.value)} /></label>
            <label>Data da compra (opcional)<input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
            <p className="muted small full">Com preço médio e data da compra, o site compara o resultado com o CDI. Comprou em várias datas? Use a da primeira compra.</p>
          </>
        )}
        {kind === "outro" && (
          <label>Valor hoje (R$)<input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} /></label>
        )}
        {kind === "bem" && (
          <>
            <label>Tipo
              <select value={bemType} onChange={(e) => setBemType(e.target.value as NonNullable<FinItem["bemType"]>)}>
                <option value="imovel">Imóvel</option><option value="terreno">Terreno</option><option value="veiculo">Veículo</option><option value="outro">Outro bem</option>
              </select>
            </label>
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder={bemType === "veiculo" ? "Carro, moto..." : "Apartamento, casa..."} /></label>
            <label>{initial?.kind === "bem" && initial.valueAt && parse(value) === initial.value
              ? `Valor estimado em ${new Date(initial.valueAt).toLocaleDateString("pt-BR")} (R$; mude para atualizar hoje)`
              : "Valor estimado hoje (R$)"}<input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} placeholder="ex.: 250.000" /></label>
            <label>Quanto pagou (R$, opcional)<input value={paid} inputMode="decimal" onChange={(e) => setPaid(e.target.value)} /></label>
            <label>Valoriza/deprecia % ao ano (opcional)<input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder={bemType === "veiculo" ? "ex.: -10" : "ex.: 4"} /></label>
          </>
        )}
      </div>
      {kind === "bem" && (
        <label className="check"><input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} /> Contar no patrimônio (desmarque para só registrar)</label>
      )}
      {kind !== "acao" && kind !== "bem" && (
        <label className="check"><input type="checkbox" checked={reserva} onChange={(e) => setReserva(e.target.checked)} />
          Faz parte da reserva de emergência (dinheiro que pode sacar a qualquer hora)</label>
      )}
      {err && <p className="error small">{err}</p>}
      <div className="row">
        <button type="submit" className="primary">{initial ? "Salvar" : "Adicionar"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}


// Comparacao com o CDI: o mesmo dinheiro, aplicado na mesma data, a 100% do CDI
function CdiCard({ rows, fin }: { rows: FinRow[]; fin: FinanceDoc | null }) {
  const { list, missing, old, first } = compareCdi(rows, fin);
  if (!list.length && !missing.length && !old.length) return null;
  const cost = list.reduce((s, c) => s + c.cost, 0);
  const now = list.reduce((s, c) => s + c.now, 0);
  const cdiV = list.reduce((s, c) => s + c.cdiValue, 0);
  const diff = now - cdiV;
  const names = (rs: FinRow[]) => rs.map((r) => r.item.name).join(", ");
  const dBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return (
    <section className="card">
      <div className="card-head"><h2>Comparação com o CDI</h2><span className="muted small">o mesmo dinheiro, na mesma data, a 100% do CDI</span></div>
      {list.length > 0 && (
        <>
          <div className="kpis">
            <div><span>Você aplicou</span><b>{brl(cost)}</b><small className="muted">{list.length} {list.length === 1 ? "investimento com data" : "investimentos com data"}</small></div>
            <div><span>Vale hoje + proventos</span><b>{brl(now)}</b><small className={pnlClass(now - cost)}>{signed(now - cost)} ({pctS((now - cost) / cost)})</small></div>
            <div><span>No CDI teria</span><b>{brl(cdiV)}</b><small className="muted">{signed(cdiV - cost)} ({pctS((cdiV - cost) / cost)})</small></div>
            <div><span>Diferença</span><b className={pnlClass(diff)}>{signed(diff)}</b><small className="muted">{diff >= 0 ? "acima do CDI" : "abaixo do CDI"}</small></div>
          </div>
          <div className="table-scroll">
            <table className="stack cdi-cmp">
              <thead><tr><th>Investimento</th><th>Desde</th><th>Rendeu</th><th>CDI no período</th><th>Contra o CDI</th></tr></thead>
              <tbody>
                {[...list].sort((a, b) => b.diff - a.diff).map((c) => (
                  <tr key={c.row.item.id}>
                    <td><b>{c.row.item.name}</b> <span className="tag">{c.row.kindLabel}</span>
                      {c.divs > 0 && <div className="muted small">inclui {brl(c.divs)} de proventos</div>}</td>
                    <td data-label="Desde"><span className="cell">{dBR(c.since)}<small className="muted">{c.days >= 365 ? `${fmt(c.days / 365, 1)} anos` : `${c.days} dias`}</small></span></td>
                    <td data-label="Rendeu" className={pnlClass(c.ret)}>{c.ret > 0 ? "+" : ""}{pctS(c.ret)}</td>
                    <td data-label="CDI no período" className="muted">+{pctS(c.cdiRet)}</td>
                    <td data-label="Contra o CDI"><span className="cell"><b className={pnlClass(c.diff)}>{signed(c.diff)}</b>
                      <small className="muted">{c.days < 90 ? "período curto: diz pouco" : c.ret < 0 ? "perdeu dinheiro" : c.cdiRet > 0 ? `${fmt((c.ret / c.cdiRet) * 100, 0)}% do CDI` : ""}</small></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {missing.length > 0 && <p className="small">Para comparar, informe o preço médio e a data da compra (em &quot;alterar&quot;): <b>{names(missing)}</b>.</p>}
      {old.length > 0 && first && <p className="small muted">Comprados antes de {dBR(first)}, início do histórico do CDI guardado: {names(old)}.</p>}
      <Note>
        Valores brutos, antes de IR e taxas. Se comprou em várias datas, a conta usa o preço médio como se tudo tivesse sido comprado
        na data informada, então é aproximada. Proventos contam com a quantidade de hoje; cupons do Tesouro com juros semestrais não
        entram. Cofrinhos não aparecem aqui porque já rendem um % do CDI. Comparar menos de 3 meses diz pouco. Não é recomendação de investimento.
      </Note>
    </section>
  );
}

// Proventos: quanto cada papel pagou por cota em 12 meses e o que isso daria com a quantidade atual
function Dividends({ rows, fin }: { rows: FinRow[]; fin: FinanceDoc | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const papers = rows.filter((r) => r.item.kind === "acao" && fin?.quotes?.[(r.item.ticker ?? "").toUpperCase()]);
  if (!papers.length) return null;
  const now = new Date();
  // Ultimos 12 meses (data ex do provento), com a quantidade de hoje
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), year: d.getFullYear(), v: 0 };
  });
  const list = papers.map((r) => {
    const q = fin!.quotes[(r.item.ticker ?? "").toUpperCase()];
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
    const last12 = q.divs.filter((d) => d.t >= start && d.t <= Date.now());
    for (const d of last12) {
      const dt = new Date(d.t);
      const m = months.find((x) => x.key === `${dt.getFullYear()}-${dt.getMonth()}`);
      if (m) m.v += d.v * (r.item.qty ?? 0);
    }
    const per = last12.reduce((s, d) => s + d.v, 0);
    return { r, q, per, count: last12.length, last: q.divs[q.divs.length - 1] };
  }).sort((a, b) => b.per * (b.r.item.qty ?? 0) - a.per * (a.r.item.qty ?? 0));
  const paying = list.filter((x) => x.per > 0);
  const none = list.filter((x) => !(x.per > 0)).map((x) => x.r.item.ticker);
  const max = Math.max(...months.map((m) => m.v), 0);
  const year = months.reduce((s, m) => s + m.v, 0);
  const hov = hover !== null ? months[hover] : null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Proventos</h2>
        <span className="muted small">{brl(year)} em 12 meses com a quantidade de hoje - ~{brl(year / 12)}/mês</span>
      </div>
      {max > 0 && (
        <figure className="viz">
          <figcaption className="small muted">Por mês (data com) {hov ? `- ${hov.label}/${hov.year}: ${brl(hov.v)}` : ""}</figcaption>
          <div className="mbars" onMouseLeave={() => setHover(null)}>
            {months.map((m, i) => (
              <div key={m.key} className={`mbar${hover !== null && hover !== i ? " dim" : ""}`} onMouseEnter={() => setHover(i)} title={`${m.label}/${m.year}: ${brl(m.v)}`}>
                <span className="mbar-fill" style={{ height: `${max > 0 ? (m.v / max) * 100 : 0}%` }} />
                <small>{m.label}</small>
              </div>
            ))}
          </div>
        </figure>
      )}
      <div className="table-scroll">
        <table className="stack divs">
          <thead><tr><th>Papel</th><th>Por cota (12 m)</th><th>Dividend yield</th><th>Pagamentos</th><th>Último</th><th>Você receberia/ano</th></tr></thead>
          <tbody>
            {paying.map(({ r, per, count, last }) => (
              <tr key={r.item.id}>
                <td><b>{r.item.ticker}</b> <span className="tag">{r.kindLabel}</span><div className="muted small">{short(fin!.quotes[(r.item.ticker ?? "").toUpperCase()].name)}</div></td>
                <td data-label="Por cota (12 m)">{per > 0 ? brl(per, 4) : "-"}</td>
                <td data-label="Dividend yield">{r.yieldYear !== null ? pctS(r.yieldYear) : "-"}</td>
                <td data-label="Pagamentos">{count}</td>
                <td data-label="Último">{last ? <span className="cell">{new Date(last.t).toLocaleDateString("pt-BR")}<small className="muted">{brl(last.v, 4)} por cota</small></span> : "-"}</td>
                <td data-label="Você receberia/ano"><b>{brl(per * (r.item.qty ?? 0))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {none.length > 0 && <p className="muted small">Sem proventos nos últimos 12 meses: {none.join(", ")}.</p>}
      <Note>
        Proventos = dividendos + JCP, por data com (Yahoo Finance; JCP aparece bruto, antes dos 15% de IR). Dividend yield alto sozinho
        não diz muito: muitas vezes vem de uma ação que caiu. Olhe a constância dos pagamentos ao longo dos anos.
      </Note>
    </section>
  );
}

// ---------- "O que voce quer lancar?" (unico lugar de entrada) ----------
export type EntryType = "mov" | "cartao" | "import" | "inv" | "bem" | "fixo" | "pagar" | "entrada" | "conta";

// Folha de cadastro/alteracao de conta a pagar, entrada fixa e conta/saldo: abre por cima da tela de onde veio o "alterar" ou "+"
// (lancar gasto, cartao e importar ficam na folha Lancar, do botao +)
const ENTRY_TITLE: Partial<Record<EntryType, [string, string]>> = {
  fixo: ["Nova conta a pagar", "Alterar conta a pagar"], pagar: ["Nova conta a pagar", "Alterar conta a pagar"],
  entrada: ["Nova entrada fixa", "Alterar entrada fixa"], conta: ["Nova conta", "Alterar conta"],
};
function EntrySheet({ entry, onClose, months, setup }: {
  entry: { type: EntryType; id: string | null } | null; onClose: () => void; months: Record<string, MonthDoc>; setup: GastosSetup;
}) {
  const type = entry?.type;
  const id = entry?.id ?? null;
  const accounts = accountsOf(setup);
  const cur = setup.fixos.find((f) => f.id === id) ?? null;
  const [onceMode, setOnceMode] = useState(false);
  useEffect(() => { setOnceMode(type === "pagar"); }, [type, id]);
  const isOnce = cur ? !!cur.once : onceMode;
  const done = (m?: string) => { onClose(); if (m) void tell(m); };
  const saveAccounts = async (list: Account[], m: string) => {
    try { await saveSetup({ accounts: JSON.parse(JSON.stringify(list)), account: null } as Partial<GastosSetup>); done(m); }
    catch { await tell("Não salvou (sem conexão?). Tente de novo."); }
  };
  const usedAcc = new Set(Object.values(months).flatMap((md) => md.items.map((g) => g.acc ?? (g.card ? "" : accounts[0]?.id))));
  const t = type ? ENTRY_TITLE[type] : undefined;
  return (
    <Sheet open={!!t} onClose={onClose} title={t ? t[id ? 1 : 0] : ""}>
      <div className="ls-form">
        {(type === "fixo" || type === "pagar") && !cur && <>
          <Segmented label="Repete?" value={onceMode ? "uma" : "mes"} onChange={(v) => setOnceMode(v === "uma")}
            options={[{ id: "mes", label: "Todo mês" }, { id: "uma", label: "Uma vez só" }]} />
          <p className="muted small">{onceMode ? "Boleto, conserto, IPVA..." : "Aluguel, internet, luz..."}</p>
        </>}
        {type === "entrada" && <FixoForm key={`${id ?? "novo"}-in`} setup={setup} fixo={cur && cur.entrada ? cur : null} entrada onDone={done} />}
        {(type === "fixo" || type === "pagar") && !isOnce && <FixoForm key={`${id ?? "novo"}-fixo`} setup={setup} fixo={cur} onDone={done} />}
        {(type === "fixo" || type === "pagar") && isOnce && <PayableForm key={`${id ?? "novo"}-once`} setup={setup} fixo={cur} onDone={done} />}
        {type === "conta" && (
          <AccountForm key={id ?? "novo"} acc={accounts.find((a) => a.id === id) ?? null}
            canRemove={!!id && accounts.length > 1 && !usedAcc.has(id)}
            onCancel={onClose}
            onRemove={() => saveAccounts(accounts.filter((a) => a.id !== id), "Conta removida.")}
            onSave={(a) => saveAccounts(accounts.some((x) => x.id === a.id) ? accounts.map((x) => (x.id === a.id ? a : x)) : [...accounts, a],
              `${accounts.some((x) => x.id === a.id) ? "Salva" : "Adicionada"}: conta ${a.name}${a.balance !== undefined ? `, saldo ${a.balance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}.`)} />
        )}
      </div>
    </Sheet>
  );
}

// Metas de economia: quanto ja tem, quanto falta e quanto guardar por mes
function GoalsCard({ setup, rows }: { setup: GastosSetup; rows: FinRow[] }) {
  const goals = setup.goals ?? [];
  const [edit, setEdit] = useState<string | null>(null); // id ou "new"
  const invs = rows.filter((r) => r.item.kind !== "bem");
  const currentOf = (g: Goal) => (g.inv ? invs.find((r) => r.item.id === g.inv)?.value ?? 0 : g.saved ?? 0);
  const write = async (list: Goal[]) => { await saveSetup({ goals: JSON.parse(JSON.stringify(list)) }); setEdit(null); };
  return (
    <section className="card">
      <div className="card-head"><h2>Metas</h2><button className="ghost small-btn" onClick={() => setEdit(edit === "new" ? null : "new")}>{edit === "new" ? "fechar" : "+ nova meta"}</button></div>
      {edit === "new" && <GoalForm invs={invs} onSave={(g) => write([...goals, g])} onCancel={() => setEdit(null)} />}
      {goals.length ? (
        <div className="goals">
          {goals.map((g) => {
            const st = goalStatus(g, currentOf(g));
            const src = g.inv ? invs.find((r) => r.item.id === g.inv)?.item.name : null;
            return (
              <div key={g.id} className="goal">
                <div className="goal-head"><b>{g.name}</b>
                  <span className="small">{brl(st.current)} de {brl(g.target)} <b className={st.done ? "pos" : ""}>{fmt(st.pct * 100, 0)}%</b></span></div>
                <div className="limit"><span className={st.done ? "limit-fill paid" : "limit-fill"} style={{ width: `${st.pct * 100}%` }} /></div>
                <div className="goal-foot small muted">
                  <span>{st.done ? "Meta atingida!" : st.late ? `prazo passou (${monthLabel(g.by!)}): faltam ${brl(st.left)}`
                    : st.perMonth !== null ? `faltam ${brl(st.left)}: guardar ${brl(st.perMonth)} por mês até ${monthLabel(g.by!)}` : `faltam ${brl(st.left)}`}
                    {src ? ` - acompanha o saldo de ${src}` : g.inv ? " - investimento removido" : " - valor informado à mão"}</span>
                  <button className="link" onClick={() => setEdit(edit === g.id ? null : g.id)}>alterar</button>
                </div>
                {edit === g.id && <GoalForm goal={g} invs={invs} onSave={(n) => write(goals.map((x) => (x.id === g.id ? n : x)))} onCancel={() => setEdit(null)}
                  onRemove={() => write(goals.filter((x) => x.id !== g.id))} />}
              </div>
            );
          })}
        </div>
      ) : edit !== "new" && <p className="muted small">Nenhuma meta. Ex.: reserva de emergência, viagem, entrada de um carro. Ligando a meta a um cofrinho, o progresso anda sozinho.</p>}
    </section>
  );
}

function GoalForm({ goal, invs, onSave, onCancel, onRemove }: { goal?: Goal; invs: FinRow[]; onSave: (g: Goal) => void; onCancel: () => void; onRemove?: () => void }) {
  const cur = monthOf(todayBR());
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? fmt(goal.target) : "");
  const [by, setBy] = useState(goal?.by ?? "");
  const [inv, setInv] = useState(goal?.inv ?? "");
  const [saved, setSaved] = useState(goal?.saved !== undefined ? fmt(goal.saved) : "");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !(parse(target) > 0)) return;
    onSave({ id: goal?.id ?? newId(), name: name.trim(), target: Math.round(parse(target) * 100) / 100, ...(by ? { by } : {}),
      ...(inv ? { inv } : { saved: Math.round(parse(saved) * 100) / 100 }) });
  };
  const opts = Array.from({ length: 121 }, (_, i) => addMonths(cur, i));
  return (
    <form className="fin-form loan-pay" onSubmit={submit}>
      <div className="row wrapline">
        <label className="grow">Meta<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reserva de emergência, viagem..." /></label>
        <label>Quanto quer juntar (R$)<input value={target} inputMode="decimal" onChange={(e) => setTarget(e.target.value)} placeholder="10.000,00" /></label>
        <label>Até quando (opcional)
          <select value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">sem prazo</option>
            {by && !opts.includes(by) && <option value={by}>{monthLabel(by)}</option>}
            {opts.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label>Onde está o dinheiro
          <select value={inv} onChange={(e) => setInv(e.target.value)}>
            <option value="">informar o valor à mão</option>
            {invs.map((r) => <option key={r.item.id} value={r.item.id}>saldo de {r.item.name}</option>)}
          </select>
        </label>
        {!inv && <label>Já guardado (R$)<input value={saved} inputMode="decimal" onChange={(e) => setSaved(e.target.value)} placeholder="0,00" /></label>}
      </div>
      <div className="row">
        <button className="primary" type="submit" disabled={!name.trim() || !(parse(target) > 0)}>{goal ? "Salvar" : "Adicionar"}</button>
        <button className="ghost" type="button" onClick={onCancel}>Cancelar</button>
        {onRemove && <button className="ghost small-btn" type="button" onClick={onRemove}>remover meta</button>}
      </div>
    </form>
  );
}

// Conferir o cofrinho com o app do banco: mostra como o site chegou no valor, grava o saldo do banco como o novo saldo
// e, com duas conferencias, calcula o % do CDI que rendeu de verdade (contando os movimentos ligados no meio)
function CheckBank({ item, row, fin, flows, months, onCheck }: {
  item: FinItem; row: FinRow | undefined; fin: FinanceDoc | null; flows: Flow[]; months: Record<string, MonthDoc>; onCheck: (it: FinItem) => Promise<void>;
}) {
  const [v, setV] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const c = row?.calc;
  const est = row?.value ?? null;
  const checks = item.checks ?? [];
  const today = dayBR(Date.now());
  const confer = async () => {
    const bank = Math.round(parse(v) * 100) / 100;
    if (!(bank >= 0) || !v.trim() || est === null) return;
    const next: FinItem = { ...item, balance: bank, balanceAt: Date.now(), checks: [...checks.filter((x) => x.d !== today), { d: today, bank, est: Math.round(est * 100) / 100 }].slice(-12) };
    // mostra o resultado na hora; a gravacao segue (sem internet, o Firebase envia quando voltar)
    onCheck(next).catch(() => { void tell("Não salvou a conferência (modo suporte ou sem conexão). Tente de novo."); });
    const diff = bank - est;
    setMsg(Math.abs(diff) < 0.01 ? "Bateu certinho com o estimado." : `Estimado ${brl(est)} · banco ${brl(bank)} · diferença ${diff > 0 ? "+" : "−"}${brl(Math.abs(diff))}. O saldo do banco virou o novo saldo de hoje.`);
    setV("");
  };
  // % do CDI de verdade entre as duas ultimas conferencias
  const [a, b] = checks.slice(-2);
  const pct = a && b && fin?.cdi.d.length ? impliedCdiPct(fin, { d: a.d, v: a.bank }, { d: b.d, v: b.bank }, flows) : null;
  const curPct = item.cdiPct ?? 100;
  const gap = a && b ? b.bank - b.est : 0;
  const strange = !!(a && b) && pct === null && Math.abs(gap) > 1;
  // lancamentos de Investimento sem destino no periodo (candidatos a movimento que faltou ligar)
  const loose = a && b ? Object.values(months).flatMap((md) => md.items).filter((g) => g.cat === INVEST_CAT && !g.inv && g.d > a.d && g.d <= b.d) : [];
  const setShows = (shows: "bruto" | "liquido") => onCheck({ ...item, shows });
  return (
    <div className="chk">
      <b className="chk-title">Conferir com o app do banco</b>
      {!fin?.cdi.d.length && <p className="mes-line">Sem os dados do CDI ainda: o valor é o saldo informado mais os movimentos ligados.</p>}
      {c ? (
        <ul className="chk-calc">
          <li><span>Saldo informado em {new Date(c.at).toLocaleDateString("pt-BR")}</span><b>{brl(c.base)}</b></li>
          {c.flows.map((x) => <li key={x.d + x.v}><span>{x.v >= 0 ? "Guardou" : "Resgatou"} em {x.d.slice(8, 10)}/{x.d.slice(5, 7)} (do extrato)</span><b>{x.v >= 0 ? "+" : "−"}{brl(Math.abs(x.v))}</b></li>)}
          <li><span>Rendimento estimado ({curPct.toLocaleString("pt-BR")}% do CDI, bruto)</span><b>+{brl(c.gain)}</b></li>
          <li className="tot"><span>Estimado hoje{c.net !== null ? " (bruto)" : ""}</span><b>{brl(c.gross)}</b></li>
          {c.net !== null && <li className="tot"><span>Líquido estimado (IR {Math.round(irRate(Math.floor((Date.now() - (item.since ?? c.at)) / 86_400_000)) * 1000) / 10}%) · conta no patrimônio</span><b>{brl(c.net)}</b></li>}
        </ul>
      ) : null}
      <div className="chk-form">
        <label>Quanto o app do banco mostra hoje? (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder={est !== null ? fmt(est) : "0,00"} /></label>
        <Button variant="primary" disabled={!v.trim() || est === null} onClick={confer}>Conferir</Button>
      </div>
      {msg && <p className="ls-msg">{msg}</p>}
      <div className="chk-shows">
        <span className="mes-line">O app do banco mostra o saldo:</span>
        <Segmented label="Bruto ou líquido" value={item.shows ?? "bruto"} onChange={setShows}
          options={[{ id: "bruto", label: "Bruto" }, { id: "liquido", label: "Líquido (com IR)" }]} />
      </div>
      {pct !== null && Math.abs(pct * 100 - curPct) > 3 && (
        <p className="chk-tip">Entre {a.d.slice(8, 10)}/{a.d.slice(5, 7)} e {b.d.slice(8, 10)}/{b.d.slice(5, 7)} o cofrinho rendeu como <b>{fmt(pct * 100, 0)}% do CDI</b> (cadastrado: {curPct.toLocaleString("pt-BR")}%).
          {item.shows !== "liquido" && pct * 100 < curPct ? " Se o app mostra o valor já sem IR, escolha \"Líquido\" acima." : ""}
          <Button variant="link" size="sm" onClick={() => onCheck({ ...item, cdiPct: Math.round(pct * 1000) / 10 })}>usar {fmt(pct * 100, 0)}%</Button></p>
      )}
      {pct !== null && Math.abs(pct * 100 - curPct) <= 3 && <p className="mes-line">Entre as duas últimas conferências rendeu como {fmt(pct * 100, 0)}% do CDI: bate com o cadastrado.</p>}
      {strange && (
        <div className="chk-tip warn-tip">
          <p>Diferença grande na última conferência ({gap > 0 ? "+" : "−"}{brl(Math.abs(gap))}): não dá para ser só a taxa. Deve haver um depósito ou resgate que não está ligado a este cofrinho
            (guardou ou resgatou direto no app, pagou algo com a caixinha...).</p>
          {loose.length > 0 && <ul>{loose.map((g) => <li key={g.id}>{g.d.slice(8, 10)}/{g.d.slice(5, 7)} {g.desc.slice(0, 40)} {brl(g.v)} <span className="ls-soft">sem destino: ligue no Mês</span></li>)}</ul>}
        </div>
      )}
      {checks.length > 0 && (
        <details className="chk-hist"><summary>Conferências ({checks.length})</summary>
          <ul>{[...checks].reverse().map((x) => <li key={x.d}><span>{x.d.slice(8, 10)}/{x.d.slice(5, 7)}/{x.d.slice(2, 4)}</span><span>banco {brl(x.bank)}</span>
            <span className={Math.abs(x.bank - x.est) < 1 ? "pos" : "warn"}>{x.bank - x.est >= 0 ? "+" : "−"}{brl(Math.abs(x.bank - x.est))}</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}
