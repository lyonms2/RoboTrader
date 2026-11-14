"use client";
import { deleteField, doc, setDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { GROUPS, cdiYear, compareCdi, financeSummary, tesouroOptions, type FinGroup, type FinRow } from "@/lib/financeMath";
import type { AppConfig, FinanceDoc, FinItem, FinKind, WalletDoc } from "@/lib/types";
import { INVEST_CAT, goalStatus, type Goal, recvStatus, accountBalance, accountsOf, addMonths, dirOf, investFlows, monthLabel, monthOf, newId, todayBR, type Account, type Card, type Gasto, type GastosSetup, type Loan, type MonthDoc } from "@/lib/gastos";
import GastosCard, { guardWrite, AccountForm, AccountsPanel, CardForm, DebtsBlock, FixoForm, Fixos, ImportPanel, LoanForm, QuickAdd, monthSnapshot, saveSetup, upcoming, PayableForm } from "./GastosCard";
import CardsLoans, { type CardsEntry } from "./CardsLoans";
import { netWorth, type NetWorthDoc } from "@/lib/patrimonio";
import { ask, askText, tell } from "./Dialog";

import Note from "./Note";
import { BalanceEq, FinBar } from "./OverviewBlocks";
export { MonthAndUpcoming, NetWorthBlock, PatrimonioCard } from "./OverviewBlocks";
import ExportData from "./ExportData";
import ShoppingList from "./ShoppingList";
// membro: dados em users/{uid}/ (o dono exporta tambem as operacoes manuais)
const isMemberBase = () => P("").startsWith("users/");
// Resumo = ver como esta; Lancamentos = unico lugar onde o dinheiro se move; Contas e bens = unico lugar com saldos e cadastros
// O resumo (patrimonio, mes, proximos pagamentos, evolucao) fica na Visao geral
export type Sub = "lanc" | "invest" | "cards" | "bens" | "compras";
const SUBS: { id: Sub; label: string }[] = [
  { id: "bens", label: "Contas e bens" }, { id: "lanc", label: "Lançamentos" }, { id: "invest", label: "Investimentos" },
  { id: "cards", label: "Cartões e empréstimos" }, { id: "compras", label: "Lista de compras" },
];
const OLD_SUB: Record<string, Sub> = { gastos: "lanc", dividas: "bens", resumo: "lanc", loans: "cards", recv: "cards" };

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
export default function FinanceCard({ cfg, fin, wallet, onChanged, onQuotes, spend, debt, months, setup }: {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; onChanged: () => void; onQuotes?: () => Promise<void>;
  spend: { value: number; months: number } | null; // media de gastos
  debt: { total: number; loans: number; cards: number; recv: number };
  months: Record<string, MonthDoc>; setup: GastosSetup;
}) {
  // Sub-aba aberta, lembrada neste navegador
  const [sub, setSubState] = useState<Sub>(() => {
    try {
      const raw = localStorage.getItem("finSub") ?? "";
      const v = (OLD_SUB[raw] ?? raw) as Sub;
      return SUBS.some((x) => x.id === v) ? v : "bens";
    } catch {
      return "bens";
    }
  });
  const setSub = (v: Sub) => {
    setSubState(v);
    try { localStorage.setItem("finSub", v); } catch { /* sem armazenamento */ }
    window.scrollTo({ top: 0 });
  };
  const [entry, setEntry] = useState<{ type: EntryType; id: string | null }>({ type: "mov", id: null });
  // "loans" (aviso de parcela atrasada na Visao geral) abre direto em Emprestimos
  const [cardsEntry, setCardsEntry] = useState<CardsEntry>(() => {
    try {
      const v = localStorage.getItem("finSub");
      if (v === "loans") return { type: "loan", id: null };
      if (v === "recv") return { type: "recv", id: null };
    } catch { /* sem armazenamento */ }
    return { type: "compra", id: null };
  });
  // investimento aberto para incluir/alterar na sub-aba Investimentos (undefined = fechado, null = novo)
  const [invEdit, setInvEdit] = useState<string | null | undefined>(undefined);
  const [bemEdit, setBemEdit] = useState<string | null | undefined>(undefined); // bens tambem se cadastram em Investimentos
  // cartao e emprestimo se lancam em Cartoes e emprestimos; investimento em Investimentos; o resto em Lancamentos
  const goEdit = (type: EntryType | "card" | "loan", id: string | null) => {
    if (type === "card" || type === "loan") { setCardsEntry({ type, id }); setSub("cards"); return; }
    if (type === "inv") { setInvEdit(id); setSub("invest"); return; }
    if (type === "bem") { setBemEdit(id); setSub("invest"); return; }
    setEntry({ type, id }); setSub("lanc");
  };
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));

  async function save(list: FinItem[], fetchQuotes: boolean) {
    guardWrite();
    await setDoc(doc(db(), P("config/main")), { finance: JSON.parse(JSON.stringify(list)) }, { merge: true });
    if (fetchQuotes) onChanged();
  }
  const upsert = async (it: FinItem) => {
    const list = items.some((x) => x.id === it.id) ? items.map((x) => (x.id === it.id ? it : x)) : [...items, it];
    if (it.kind === "bem") setBemEdit(undefined); else setInvEdit(undefined);
    await save(list, it.kind === "acao" || it.kind === "tesouro");
  };
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
  const bruto = contas + investido + s.bens + debt.recv;
  const liquido = bruto - debt.total;
  const finGroups = { ...s.byGroup, cripto: 0, dolar: 0 };
  const invRows = rows.filter((r) => r.item.kind !== "bem");
  const invTot = invRows.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.value ?? 0), 0);
  const invMonthly = invRows.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.monthly ?? 0), 0);
  const bemRows = rows.filter((r) => r.item.kind === "bem");

  const nav = (
    <nav className="subtabs" role="tablist" aria-label="Finanças">
      {SUBS.map((x) => (
        <button key={x.id} role="tab" aria-selected={sub === x.id} className={sub === x.id ? "pill on" : "pill"} onClick={() => setSub(x.id)}>{x.label}</button>
      ))}
    </nav>
  );
  const entryPanel = (
    <EntryPanel entry={entry} setEntry={setEntry} months={months} setup={setup} invest={items} fin={fin}
      onSaveInv={upsert} onRemoveInv={remove} />
  );
  if (sub === "compras") return <>{nav}<ShoppingList months={months} setup={setup} ipca12m={fin?.ipca12m ?? null} /></>;
  if (sub === "cards") return <>{nav}<CardsLoans months={months} setup={setup} invest={items} entry={cardsEntry} setEntry={setCardsEntry} /></>;
  if (sub === "invest") return (
    <>{nav}<InvestPart items={items} rows={rows} fin={fin} months={months} reserve={s.reserve} reserveMonths={s.reserveMonths}
      setup={setup} onQuotes={onQuotes} edit={invEdit} setEdit={setInvEdit} bemEdit={bemEdit} setBemEdit={setBemEdit} bensTotal={s.bens} onSave={upsert} onRemove={remove} onLanc={() => setSub("lanc")} /></>
  );
  if (sub === "lanc") return <>{nav}<GastosCard months={months} setup={setup} invest={items} onBens={() => setSub("bens")} entry={entryPanel} /></>;

  return (
    <>
      {nav}
      {sub === "bens" && <>
      <section className="card">
        <h2>Balanço</h2>
        <div className="hero">
          <div className="hero-main">
            <span>O que você tem em Finanças</span>
            <b>{brl(bruto)}</b>
            <small>contas, investimentos{s.bens > 0 ? ", bens" : ""}{debt.recv > 0 ? " e o que te devem" : ""} - sem a cripto</small>
          </div>
          <div className="hero-side">
            <div><span>Líquido (depois das dívidas)</span><b className={liquido < 0 ? "neg" : ""}>{brl(liquido)}</b>
              <small className="muted">{debt.total > 0 ? `${brl(debt.total, 0)} de dívidas` : "sem dívidas"}</small></div>
            {s.bens > 0 && <div><span>Líquido sem bens</span><b className={liquido - s.bens < 0 ? "neg" : ""}>{brl(liquido - s.bens)}</b></div>}
          </div>
        </div>
        <details className="eq-more">
          <summary>ver a conta: o que você tem - o que deve</summary>
          <BalanceEq contas={contas} investido={investido} bens={s.bens} recv={debt.recv} cards={debt.cards} loans={debt.loans} />
        </details>
        <FinBar byGroup={finGroups} />
        <Note>Só o que está nas abas de Finanças. A cripto ({brl(crypto, 0)}) fica na aba Cripto; o patrimônio da Visão geral soma tudo.
          Aqui só se vê: para lançar ou alterar, use Lançamentos (contas e contas a pagar), Investimentos (investimentos e bens),
          Cartões e empréstimos, ou o link &quot;alterar&quot; de cada item.</Note>
      </section>

      <section className="card">
        <div className="card-head"><h2>Contas</h2><span className="muted small">{brl(acct?.value ?? 0)}</span></div>
        <AccountsPanel months={months} setup={setup} m={mon.m} onEdit={(id) => goEdit("conta", id)} />
      </section>

      <section className="card">
        <div className="card-head"><h2>Investimentos</h2><span className="muted small">{brl(invTot)}{invMonthly > 0 ? ` - rende ~${brl(invMonthly, 0)}/mês` : ""}
          <button className="link" onClick={() => setSub("invest")}>ver investimentos &rsaquo;</button></span></div>
        {invRows.length ? (
          <ul className="item-bars">
            {invRows.map((r) => {
              const gain = r.cost !== null && r.value !== null ? r.value - r.cost : null;
              const pct = invTot > 0 && r.value ? r.value / invTot : 0;
              return (
                <li key={r.item.id}>
                  <div className="ib-top">
                    <span><i className={`dot g-${r.group}`} aria-hidden="true" /><b>{r.item.name}</b> <span className="tag">{r.kindLabel}</span>{r.item.reserva && <span className="tag">reserva</span>}</span>
                    <b>{r.value !== null ? brl(r.value) : "-"}</b>
                  </div>
                  <div className="ib-bar"><span className={`g-${r.group}`} style={{ width: `${Math.max(1, pct * 100)}%` }} /></div>
                  <div className="ib-sub">
                    <span className="muted">{pctS(pct, 0)} do investido{r.yieldYear !== null ? ` - ${pctS(r.yieldYear, 1)} ao ano` : ""}{r.monthly ? ` - rende ~${brl(r.monthly)}/mês` : ""}</span>
                    {gain !== null && Math.abs(gain) >= 0.01 ? <span className={pnlClass(gain)}>{signed(gain)} de lucro</span> : r.problem ? <span className="warn">{r.problem}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted small">Nenhum investimento cadastrado. Cofrinho, Tesouro, ações e FIIs se cadastram em Investimentos.</p>}
        {!bemRows.length && <p className="muted small">Imóveis e veículos: nenhum cadastrado. <button className="link" onClick={() => goEdit("bem", null)}>+ bem</button></p>}
      </section>

      {bemRows.length > 0 && <section className="card">
        <div className="card-head"><h2>Bens</h2><span className="muted small">{brl(s.bens)}<button className="link" onClick={() => goEdit("bem", null)}>+ bem</button><button className="link" onClick={() => setSub("invest")}>ver em investimentos &rsaquo;</button></span></div>
        {bemRows.length ? (
          <ul className="pend small">
            {bemRows.map((r) => (
              <li key={r.item.id}>
                <b>{r.item.name}</b> <span className="tag">{r.kindLabel}</span>
                <span className="muted">{r.note}{r.cost !== null && r.value !== null ? ` - pagou ${brl(r.cost, 0)}` : ""}</span>
                <span className={r.item.ignore ? "muted" : ""}>{r.value !== null ? brl(r.value, 0) : "-"}</span>
                <button className="link" onClick={() => goEdit("bem", r.item.id)}>alterar</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Nenhum bem cadastrado. Imóveis, terrenos e veículos entram no patrimônio &quot;com bens&quot;, separados do financeiro.</p>}
      </section>}

      {(setup.recvs ?? []).length > 0 && (
        <section className="card">
          <div className="card-head"><h2>A receber</h2><span className="muted small">{brl(debt.recv)}
            <button className="link" onClick={() => { setCardsEntry({ type: "recv", id: null }); setSub("cards"); }}>ver a receber &rsaquo;</button></span></div>
          <ul className="item-bars">
            {(setup.recvs ?? []).map((r) => {
              const st = recvStatus(r, months);
              const conta = r.kind === "conta";
              const pct = !conta && r.n ? st.got / r.n : 0;
              return (
                <li key={r.id}>
                  <div className="ib-top">
                    <span><b>{r.name}</b> <span className="tag">{r.kind === "emprestei" ? "empréstimo" : r.kind === "venda" ? "venda" : "conta com a pessoa"}</span>
                      {st.late > 0 && <span className="chip warn-chip">{st.late} atrasada{st.late > 1 ? "s" : ""}</span>}</span>
                    <b className={conta && st.saldo < 0 ? "warn" : "pos"}>{brl(conta ? Math.abs(st.saldo) : st.leftV)}</b>
                  </div>
                  {!conta && <div className="ib-bar"><span className="g-acoes" style={{ width: `${Math.max(1, pct * 100)}%` }} /></div>}
                  <div className="ib-sub">
                    <span className="muted">{conta ? (st.saldo >= 0 ? "te deve hoje" : "você deve a ela")
                      : `${st.got} de ${r.n} parcelas recebidas${st.next && !st.late ? ` - próxima ${dm(st.next)}` : ""}`}{st.late > 0 ? ` - ${brl(st.lateV)} atrasado` : ""}</span>
                    <button className="link" onClick={() => { setCardsEntry({ type: "recv", id: r.id }); setSub("cards"); }}>abrir &rsaquo;</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h3 className="bal-title">O que você deve <span className="bal-sum">{brl(debt.total)}</span></h3>
      <DebtsBlock months={months} setup={setup} onEdit={(t, id) => goEdit(t, id)} />

      <h3 className="bal-title">Compromissos todo mês</h3>
      <Fixos setup={setup} months={months} onEdit={(id) => goEdit("fixo", id)} />
      <Fixos setup={setup} months={months} entrada onEdit={(id) => goEdit("entrada", id)} />

      <section className="card">
        <h2>Seus dados</h2>
        <ExportData owner={!isMemberBase()} />
      </section>
      </>}
    </>
  );
}

// ---------- sub-aba Investimentos: cadastro, carteira, aportes/resgates e proventos ----------
function InvestPart({ items, rows, fin, months, setup, reserve, reserveMonths, onQuotes, edit, setEdit, bemEdit, setBemEdit, bensTotal, onSave, onRemove, onLanc }: {
  items: FinItem[]; rows: FinRow[]; fin: FinanceDoc | null; months: Record<string, MonthDoc>;
  setup: GastosSetup; reserve: number; reserveMonths: number | null; onQuotes?: () => Promise<void>;
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
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Investimentos</h2>
          <span className="head-actions">
            {onQuotes && <button className="ghost small-btn" disabled={qBusy} title="Ações, FIIs, Tesouro, CDI, IPCA e dólar"
              onClick={async () => { setQBusy(true); try { await onQuotes(); } finally { setQBusy(false); } }}>{qBusy ? "Atualizando..." : "Atualizar cotações"}</button>}
            <button className="primary small-btn" onClick={() => setEdit(null)}>+ novo investimento</button>
          </span></div>
        {fin && <p className="muted small head-note">Cotações de {new Date(fin.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (atualizam sozinhas varias vezes ao dia)</p>}
        <div className="kpis">
          <div><span>Investido hoje</span><b>{brl(total)}</b><small className="muted">{live.length} {live.length === 1 ? "investimento" : "investimentos"}, fora cripto</small></div>
          <div><span>Lucro / prejuízo</span><b className={pnlClass(gain)}>{cost > 0 ? signed(gain) : "-"}</b>
            <small className="muted">{cost > 0 ? `${pctS(gain / cost)} sobre ${brl(cost, 0)} aplicados` : "informe os preços médios"}</small></div>
          <div><span>Rende por mês (estimado)</span><b>{brl(monthly)}</b><small className="muted">{monthly > 0 ? `~${brl(monthly * 12, 0)} por ano, antes de IR` : "juros + proventos"}</small></div>
          <div><span>Reserva de emergência</span><b>{brl(reserve)}</b>
            <small className="muted">{reserveMonths !== null ? `cobre ${fmt(reserveMonths, 1)} meses de gastos` : reserve > 0 ? "quantos meses cobre: depois do 1o mês de lançamentos" : "marque \"reserva\" no investimento"}</small></div>
          <div><span>Guardou em 12 meses</span><b className={pnlClass(put - took)}>{moves.length ? signed(put - took) : "-"}</b>
            <small className="muted">{moves.length ? `aplicou ${brl(put, 0)} - resgatou ${brl(took, 0)}` : "aportes lançados no extrato"}</small></div>
        </div>
        <FinBar byGroup={byGroup} />
      </section>

      {edit !== undefined && (
        <section className="card loan-panel" ref={panel}>
          <div className="card-head"><h2>{cur ? `Alterar ${cur.name}` : "Novo investimento"}</h2></div>
          <ItemForm key={edit ?? "novo"} initial={cur} fin={fin} onSave={onSave} onCancel={() => setEdit(undefined)} />
          {cur && <button className="ghost small-btn" onClick={() => onRemove(cur)}>remover este investimento</button>}
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Sua carteira</h2><span className="muted small">{brl(total)}</span></div>
        {inv.length ? (
          <div className="table-scroll">
            <table className="stack fin grouped">
              <thead><tr><th>Investimento</th><th>Quantidade</th><th>Preço</th><th>Valor</th><th>Lucro</th><th>Rende/mês</th><th /></tr></thead>
              {GROUPS.filter((g) => inv.some((r) => r.group === g.key)).map((g) => {
                const gr = inv.filter((r) => r.group === g.key).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
                const gv = gr.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.value ?? 0), 0);
                const gm = gr.filter((r) => !r.item.ignore).reduce((t, r) => t + (r.monthly ?? 0), 0);
                return (
                  <tbody key={g.key}>
                    <tr className="grp-row">
                      <td colSpan={7}>
                        <span className="grp-name"><i className={`dot g-${g.key}`} aria-hidden="true" />{g.label}</span>
                        <span className="grp-nums"><b>{brl(gv)}</b><span className="muted">{total > 0 ? pctS(gv / total) : ""}</span>
                          {gm > 0 && <span className="muted">rende ~{brl(gm)}/mês</span>}</span>
                      </td>
                    </tr>
                    {gr.map((r) => <ItemRow key={r.item.id} r={r} onEdit={() => setEdit(r.item.id)} />)}
                  </tbody>
                );
              })}
            </table>
          </div>
        ) : (
          <p className="muted">Nenhum investimento cadastrado. Clique em &quot;+ novo investimento&quot; para incluir cofrinho, Tesouro, ações, FIIs ou outros.</p>
        )}
        <Note>
          Automático: cotação e proventos (Yahoo Finance), preço do Tesouro (Tesouro Transparente, 1 vez por dia), CDI, IPCA e dólar
          (Banco Central). À mão: quantidades, saldo do cofrinho e preços médios, porque bancos e a B3 não tem API aberta para ler sua
          posição. Valores brutos, antes de IR e taxas.
        </Note>
      </section>

      <CdiCard rows={rows} fin={fin} />

      <section className="card">
        <div className="card-head"><h2>Aportes e resgates</h2><span className="muted small">últimos 12 meses<button className="link" onClick={onLanc}>ver lançamentos &rsaquo;</button></span></div>
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

      <Dividends rows={rows} fin={fin} />

      <GoalsCard setup={setup} rows={rows} />

      <section className="card">
        <div className="card-head"><h2>Bens</h2><span className="muted small"><b>{brl(bensTotal)}</b><button className="ghost small-btn" onClick={() => setBemEdit(null)}>+ novo bem</button></span></div>
        {bemEdit !== undefined && (
          <div className="loan-panel" ref={bemPanel}>
            <p className="small"><b>{curBem ? `Alterar ${curBem.name}` : "Novo bem"}</b></p>
            <ItemForm key={bemEdit ?? "novo-bem"} only="bem" initial={curBem} fin={fin} onSave={onSave} onCancel={() => setBemEdit(undefined)} />
            {curBem && <button className="ghost small-btn" onClick={() => onRemove(curBem)}>remover este bem</button>}
          </div>
        )}
        {bens.length ? (
          <ul className="asset-list">
            {[...bens].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map((r) => {
              const dif = r.cost !== null && r.value !== null ? r.value - r.cost : null;
              return (
                <li key={r.item.id} className={r.item.ignore ? "off" : ""}>
                  <span className="a-name"><b>{r.item.name}</b>
                    <small className="muted">{r.kindLabel}{r.item.ignore ? " - fora do patrimônio" : ""}{r.note ? ` - ${r.note}` : ""}</small></span>
                  <span className="a-paid small">{r.cost !== null ? <>pagou {brl(r.cost, 0)}{dif !== null && <small className={pnlClass(dif)}>{signed(dif)}</small>}</> : <span className="muted">-</span>}</span>
                  <span className="a-v"><b>{r.value !== null ? brl(r.value, 0) : "-"}</b></span>
                  <button className="link" onClick={() => setBemEdit(r.item.id)}>alterar</button>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted small">Nenhum bem cadastrado.</p>}
        <Note>Imóveis, terrenos e veículos: entram no patrimônio &quot;com bens&quot;, separados do financeiro, e não somam no
          &quot;Investido hoje&quot; acima. O valor anda sozinho se você informar quanto valoriza ou deprecia por ano.</Note>
      </section>
    </>
  );
}

function ItemRow({ r, onEdit }: { r: FinRow; onEdit: () => void }) {
  const it = r.item;
  const qty = it.kind === "caixa" ? (it.balance !== undefined ? `saldo ${brl(it.balance)}` : "-")
    : it.kind === "outro" ? "-" : (it.qty ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  const gain = r.cost !== null && r.value !== null ? r.value - r.cost : null;
  return (
    <tr>
      <td>
        <i className={`dot g-${r.group}`} aria-hidden="true" /><b>{it.name}</b> <span className="tag">{r.kindLabel}</span>
        {it.reserva && <span className="tag">reserva</span>}
        <div className="muted small">{r.note || r.problem}</div>
      </td>
      <td data-label="Quantidade">{qty}</td>
      <td data-label="Preço">{r.price !== null ? <span className="cell">{brl(r.price)}{r.change !== null && <small className={pnlClass(r.change)}>{r.change > 0 ? "+" : ""}{pctS(r.change)} hoje</small>}</span> : "-"}</td>
      <td data-label="Valor"><b>{r.value !== null ? brl(r.value) : "-"}</b></td>
      <td data-label="Lucro" className={gain !== null ? pnlClass(gain) : "muted"}>
        {gain !== null ? <span className="cell">{signed(gain)}{r.cost! > 0 && <small>{pctS(gain / r.cost!)}</small>}</span> : it.kind === "outro" ? "-" : "informe o preço médio"}
      </td>
      <td data-label="Rende/mês">{r.monthly !== null ? <span className="cell">{brl(r.monthly)}{r.yieldYear !== null && <small className="muted">{pctS(r.yieldYear)} ao ano</small>}</span> : "-"}</td>
      <td className="actions">
        <button className="link" onClick={onEdit}>alterar</button>
      </td>
    </tr>
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
const ENTRY_TYPES: { id: EntryType; label: string }[] = [
  { id: "mov", label: "Gasto ou entrada" }, { id: "cartao", label: "Compra no cartão" }, { id: "import", label: "Importar extrato" },
  { id: "fixo", label: "Contas a pagar" }, { id: "entrada", label: "Entrada fixa" }, { id: "conta", label: "Conta / saldo" },
];

function EntryPanel({ entry, setEntry, months, setup, invest, fin, onSaveInv, onRemoveInv }: {
  entry: { type: EntryType; id: string | null }; setEntry: (e: { type: EntryType; id: string | null }) => void;
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; fin: FinanceDoc | null;
  onSaveInv: (it: FinItem) => void; onRemoveInv: (it: FinItem) => void;
}) {
  const { type, id } = entry;
  // recolhido: so a linha com os tipos; abre ao escolher um tipo (ou ao vir de um "alterar"/"+ novo" de outra tela)
  const [open, setOpen] = useState(!!entry.id || entry.type !== "mov");
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setOpen(true); }, [entry]);
  // depois de salvar: mostra o que aconteceu e limpa o formulario (n muda a key)
  const [msg, setMsg] = useState("");
  const [n, setN] = useState(0);
  const reset = () => setEntry({ type, id: null });
  const done = (m?: string) => { if (m) setMsg(m); setN((x) => x + 1); reset(); };
  const accounts = accountsOf(setup);
  // Itens existentes de cada tipo (para alterar ou remover)
  const existing: Record<string, { id: string; label: string }[]> = {
    // contas a pagar: as que repetem todo mes (fixos) e as de uma vez so
    entrada: setup.fixos.filter((f) => f.entrada).map((f) => ({ id: f.id, label: `${f.desc} (todo dia ${f.dia})` })),
    fixo: [...setup.fixos.filter((f) => !f.once && !f.entrada).map((f) => ({ id: f.id, label: `${f.desc} (todo mês)` })),
      ...setup.fixos.filter((f) => f.once).map((f) => ({ id: f.id, label: `${f.desc} (uma vez, vence ${f.due ? `${f.due.slice(8, 10)}/${f.due.slice(5, 7)}` : "-"})` }))],
    conta: accounts.map((a) => ({ id: a.id, label: a.name })),
  };
  const opts = existing[type === "pagar" ? "fixo" : type];
  // Contas a pagar: repete todo mes (fixo) ou uma vez so; ao alterar, vale o tipo da conta escolhida
  const [onceMode, setOnceMode] = useState(type === "pagar");
  const cur = setup.fixos.find((f) => f.id === id) ?? null;
  const isOnce = cur ? !!cur.once : onceMode;
  const saveAccounts = async (list: Account[], m: string) => {
    try { await saveSetup({ accounts: JSON.parse(JSON.stringify(list)), account: null } as Partial<GastosSetup>); done(m); }
    catch { setMsg(""); await tell("Não salvou (sem conexão?). Tente de novo."); }
  };
  const usedAcc = new Set(Object.values(months).flatMap((md) => md.items.map((g) => g.acc ?? (g.card ? "" : accounts[0].id))));
  return (
    <div className="entry">
      <div className="entry-bar">
        <p className="small entry-q">O que você quer lançar?</p>
        <div className="kind-pick entry-types">
          {ENTRY_TYPES.map((t) => (
            <button key={t.id} type="button" className={open && (type === t.id || (t.id === "fixo" && type === "pagar")) ? "pill on" : "pill"} onClick={() => { setMsg(""); setEntry({ type: t.id, id: null }); setOpen(true); }}>{t.label}</button>
          ))}
        </div>
        {open && <button type="button" className="link entry-close" onClick={() => setOpen(false)}>fechar</button>}
      </div>
      {open && <>
      <p className="muted small entry-hint">Investimentos e bens: em Investimentos. Cadastrar cartão, empréstimo e a receber: em Cartões e empréstimos.</p>
      {opts && (
        <label className="entry-pick small">Novo ou alterar:
          <select value={id ?? ""} onChange={(e) => { setMsg(""); setEntry({ type, id: e.target.value || null }); }}>
            <option value="">+ novo</option>
            {opts.map((o) => <option key={o.id} value={o.id}>alterar: {o.label}</option>)}
          </select>
        </label>
      )}
      {type === "mov" && <QuickAdd months={months} setup={setup} invest={invest} defaultDate={todayBR()} />}
      {type === "cartao" && (setup.cards.length
        ? <QuickAdd key="cartao" mode="cartao" months={months} setup={setup} invest={invest} defaultDate={todayBR()} />
        : <p className="muted small">Cadastre um cartão primeiro, em Cartões e empréstimos (&quot;Cadastrar cartão&quot;).</p>)}
      {type === "import" && <ImportPanel months={months} setup={setup} invest={invest} onDone={() => setEntry({ type: "mov", id: null })} />}
      {msg && <p className="small pos entry-msg">&#10003; {msg}</p>}
      {(type === "fixo" || type === "pagar") && !cur && (
        <div className="kind-pick" role="radiogroup" aria-label="Repete?">
          <button type="button" role="radio" aria-checked={!onceMode} className={!onceMode ? "pill on" : "pill"} onClick={() => setOnceMode(false)}>Todo mês (aluguel, internet, luz)</button>
          <button type="button" role="radio" aria-checked={onceMode} className={onceMode ? "pill on" : "pill"} onClick={() => setOnceMode(true)}>Uma vez só (boleto, conserto, IPVA)</button>
        </div>
      )}
      {type === "entrada" && <FixoForm key={`${id ?? "novo"}-${n}-in`} setup={setup} fixo={cur && cur.entrada ? cur : null} entrada onDone={done} />}
      {(type === "fixo" || type === "pagar") && !isOnce && <FixoForm key={`${id ?? "novo"}-${n}`} setup={setup} fixo={cur} onDone={done} />}
      {(type === "fixo" || type === "pagar") && isOnce && <PayableForm key={`${id ?? "novo"}-${n}-once`} setup={setup} fixo={cur} onDone={done} />}
      {type === "conta" && (
        <AccountForm key={`${id ?? "novo"}-${n}`} acc={accounts.find((a) => a.id === id) ?? null}
          canRemove={!!id && accounts.length > 1 && !usedAcc.has(id)}
          onCancel={reset}
          onRemove={() => saveAccounts(accounts.filter((a) => a.id !== id), "Conta removida.")}
          onSave={(a) => saveAccounts(accounts.some((x) => x.id === a.id) ? accounts.map((x) => (x.id === a.id ? a : x)) : [...accounts, a],
            `${accounts.some((x) => x.id === a.id) ? "Salva" : "Adicionada"}: conta ${a.name}${a.balance !== undefined ? `, saldo ${a.balance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}.`)} />
      )}
      </>}
      {!open && msg && <p className="small pos entry-msg">&#10003; {msg}</p>}
    </div>
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
                  <span className="small">{brl(st.current, 0)} de {brl(g.target, 0)} <b className={st.done ? "pos" : ""}>{fmt(st.pct * 100, 0)}%</b></span></div>
                <div className="limit"><span className={st.done ? "limit-fill paid" : "limit-fill"} style={{ width: `${st.pct * 100}%` }} /></div>
                <div className="goal-foot small muted">
                  <span>{st.done ? "Meta atingida!" : st.late ? `prazo passou (${monthLabel(g.by!)}): faltam ${brl(st.left, 0)}`
                    : st.perMonth !== null ? `faltam ${brl(st.left, 0)}: guardar ${brl(st.perMonth, 0)} por mês até ${monthLabel(g.by!)}` : `faltam ${brl(st.left, 0)}`}
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
