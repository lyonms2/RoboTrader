"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card as UiCard, EmptyState, Fold, List, ListRow, Money, Progress, Section, Sheet, Stat, Stats } from "./ui";
import {
  CARD_PAY_CAT, RECV_OUT_CAT, accountsOf, addMonths, cardStatus, dayIn, descKey, commitments, debts, faturaItems, faturaMonth, loanDue, loanStatus, prepaidSlots, monthLabel, monthOf, newId, tipoOfCat, todayBR,
  catLabel, parcelSiblings, subValue, type Card, type CardSub, type Gasto, type GastosSetup, type Loan, type LoanRow, type MonthDoc,
} from "@/lib/gastos";
import type { FinItem } from "@/lib/types";
import { CardForm, CatSelect, LoanForm, QuickAdd, saveMonth, saveSetup } from "./GastosCard";
import { bestBuy } from "@/lib/alerts";
import ReceivablesPart, { RecvSelect } from "./Receivables";
import { ask, tell } from "./Dialog";

import Note from "./Note";
import { budgetAlerts } from "./gastosShared";
export { budgetAlerts };
const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$\u00a0${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export type CardsEntry = { type: "compra" | "card" | "loan" | "prepay" | "recv"; id: string | null; d?: string }; // compra + id/d: abre o cartao e a fatura da compra
const STATUS: Record<string, string> = { aberta: "aberta", fechada: "fechada, a pagar", paga: "paga", vencida: "atrasada" };
const FSIT: Record<string, { cls: string; label: string }> = {
  paga: { cls: "paga", label: "paga" }, vencida: { cls: "atrasada", label: "atrasada" }, fechada: { cls: "fechada", label: "fechada" }, aberta: { cls: "aberta", label: "aberta" },
};
const NEW_LOAN = (): Loan => ({ id: newId(), name: "", parcela: 0, n: 12, first: monthOf(todayBR()), dueDay: 10, paidBefore: 0 });

// Patrimonio > Cartoes | Emprestimos | A receber (o segmento vem de fora). entry: o que abrir direto (ex.: "alterar" de outra tela)
export default function CardsLoans({ part, months, setup, invest, entry, setEntry }: {
  part: "cards" | "loans" | "recv"; months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; entry: CardsEntry; setEntry: (e: CardsEntry) => void;
}) {
  const d = debts(months, setup);
  const com = commitments(months, setup);
  return part === "cards"
    ? <CardsPart months={months} setup={setup} invest={invest} entry={entry} setEntry={setEntry} owed={d.cards} com={com} />
    : part === "loans" ? <LoansPart months={months} setup={setup} entry={entry} setEntry={setEntry} owed={d.loans} com={com} />
    : <ReceivablesPart months={months} setup={setup} openId={entry.type === "recv" ? entry.id : null} />;
}

type Com = { m: string; cards: number; loans: number }[];

function CardsPart({ months, setup, invest, entry, setEntry, owed, com }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; entry: CardsEntry; setEntry: (e: CardsEntry) => void; owed: number; com: Com;
}) {
  const cards = setup.cards;
  const [sel, setSel] = useState((entry.type === "card" || entry.type === "compra") && entry.id ? entry.id : cards[0]?.id ?? "");
  const card = cards.find((c) => c.id === sel) ?? cards[0];
  const st = card ? cardStatus(card, months) : null;
  const [fmSel, setFm] = useState<string | null>(() => (entry.type === "compra" && entry.d && card ? faturaMonth(card, entry.d) : null));
  const fm = fmSel ?? (card ? faturaMonth(card, todayBR()) : monthOf(todayBR()));
  // folhas: cadastrar/alterar cartao (vem tambem do "alterar" de outra tela) e nova compra
  const editing = entry.type === "card" ? (entry.id ?? "new") : null;
  const [buy, setBuy] = useState(false);
  const closeEdit = () => setEntry({ type: "compra", id: null });
  const editCard = editing && editing !== "new" ? cards.find((c) => c.id === editing) : null;
  const saveCard = async (c: Card) => {
    await saveSetup({ cards: cards.some((x) => x.id === c.id) ? cards.map((x) => (x.id === c.id ? c : x)) : [...cards, c] });
    setSel(c.id); setFm(null); closeEdit();
  };
  const removeCard = async (id: string) => {
    if (!await ask("Remover este cartão? (as compras continuam lançadas)")) return;
    await saveSetup({ cards: cards.filter((c) => c.id !== id) });
    setSel(""); closeEdit();
  };
  const next = com[1];
  return (
    <div className="pat-part">
      {card ? (
        <div className="pat-chips" role="tablist" aria-label="Cartões">
          {cards.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === card.id} className={c.id === card.id ? "pat-chip on" : "pat-chip"}
            onClick={() => { setSel(c.id); setFm(null); }}>{c.name}</button>)}
          <button type="button" className="pat-chip add" aria-label="Cadastrar cartão" onClick={() => setEntry({ type: "card", id: null })}><Plus size={16} aria-hidden="true" /></button>
          <Button variant="icon" size="sm" className="pat-chip-edit" aria-label={`Alterar o cartão ${card.name}`} icon={<Pencil size={15} aria-hidden="true" />} onClick={() => setEntry({ type: "card", id: card.id })} />
        </div>
      ) : (
        <UiCard><EmptyState title="Nenhum cartão ainda" text="Cadastre o cartão (dia que fecha e que vence) para ver a fatura, o melhor dia de compra e o quanto já gastou."
          action={<Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEntry({ type: "card", id: null })}>Cadastrar cartão</Button>} /></UiCard>
      )}

      {card && st && <FaturaView card={card} st={st} fm={fm} setFm={setFm} months={months} setup={setup} onBuy={() => setBuy(true)} />}
      {card && <p className="mes-line">Devendo nos cartões <b>{brl(owed, 0)}</b> (faturas a pagar e parcelas futuras) · faturas de {monthLabel(next.m)} <b>{brl(next.cards, 0)}</b></p>}

      {card && st && (
        <Fold title="Próximas faturas e assinaturas">
          <FaturasList key={card.id} card={card} st={st} fm={fm} setFm={setFm} months={months} setup={setup} />
          <SubsList key={`subs-${card.id}`} card={card} setup={setup} />
          <CommitmentsChart data={com} which="cards" />
        </Fold>
      )}

      <Sheet open={!!editing} onClose={closeEdit} title={editCard ? `Alterar ${editCard.name}` : "Cadastrar cartão"}>
        {editing && <div className="ls-form">
          <CardForm key={editing} c={editCard ?? { id: newId(), name: "", closeDay: 1, dueDay: 8 }} onSave={saveCard} onCancel={closeEdit} />
          {editCard && <Button variant="danger" size="sm" className="pay-remove" onClick={() => removeCard(editCard.id)}>Remover este cartão</Button>}
        </div>}
      </Sheet>
      <Sheet open={buy} onClose={() => setBuy(false)} title="Compra no cartão">
        {buy && card && <div className="ls-form"><QuickAdd mode="cartao" cardId={card.id} months={months} setup={setup} invest={invest} defaultDate={todayBR()}
          onAdded={(cid, d) => { const c = cards.find((x) => x.id === cid); if (c) { setSel(cid); setFm(faturaMonth(c, d)); } }} /></div>}
      </Sheet>
    </div>
  );
}

function LoansPart({ months, setup, entry, setEntry, owed, com }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; entry: CardsEntry; setEntry: (e: CardsEntry) => void; owed: number; com: Com;
}) {
  const ctx = { months, setup };
  const today = todayBR();
  const sts = setup.loans.map((l) => ({ l, st: loanStatus(l, today, ctx) }));
  const active = sts.filter((x) => x.st.left > 0);
  const lastEnd = active.reduce((m, x) => (x.st.end > m ? x.st.end : m), "");
  const saved = sts.reduce((s, x) => s + x.st.saved, 0);
  // proxima parcela a pagar (a que vence primeiro entre todos os emprestimos)
  const nx = sts.filter((x) => x.st.next).sort((a, b) => a.st.next!.localeCompare(b.st.next!))[0];
  // folha aberta: um emprestimo (detalhe, ou ja em "alterar"/"adiantar") ou "new"
  const openId = (entry.type === "loan" || entry.type === "prepay") ? entry.id : null;
  const [adding, setAdding] = useState(false);
  const close = () => { setAdding(false); setEntry({ type: "loan", id: null }); };
  const cur = sts.find((x) => x.l.id === openId);
  const saveLoan = async (l: Loan) => { await saveSetup({ loans: [...setup.loans, l] }); setAdding(false); };
  return (
    <div className="pat-part">
      {sts.length > 0 ? <>
        <Stats scroll cols={3}>
          <Stat label="Devendo" value={<Money value={owed} size="md" cents={false} />} hint={`${active.length} ${active.length === 1 ? "empréstimo" : "empréstimos"}`} />
          <Stat label="Próxima parcela" value={nx ? <Money value={nx.l.parcela} size="md" cents={false} tone={nx.st.next! < today ? "warn" : undefined} /> : "-"}
            hint={nx ? `${nx.st.next! < today ? "venceu" : "vence"} ${dm(nx.st.next!)}${sts.length > 1 ? ` · ${nx.l.name}` : ""}` : "nenhuma"} />
          <Stat label="Livre em" value={<span className="ui-money size-md">{lastEnd ? monthLabel(lastEnd) : "-"}</span>} hint={saved > 0.005 ? `economizou ${brl(saved, 0)} adiantando` : "última parcela"} />
        </Stats>
        <Section title="Seus empréstimos" action={<Button variant="link" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setAdding(true)}>empréstimo</Button>}>
          <List>
            {sts.map(({ l, st }) => (
              <ListRow key={l.id} onClick={() => setEntry({ type: "loan", id: l.id })} icon={<Landmark size={18} />} iconTone={st.late ? "neg" : st.left ? "info" : "pos"}
                title={l.name} sub={`${st.paid} de ${l.n} pagas · saldo ${brl(st.saldo, 0)}`}
                value={st.late > 0 ? <Badge tone="neg">{st.late} {st.late > 1 ? "atrasadas" : "atrasada"}</Badge> : st.next ? <span className="pat-next">{dm(st.next)} · {brl(l.parcela, 0)}</span> : <Badge tone="pos">quitado</Badge>} />
            ))}
          </List>
        </Section>
        <Fold title="Parcelas nos próximos 12 meses"><CommitmentsChart data={com} which="loans" /></Fold>
      </> : (
        <UiCard><EmptyState title="Nenhum empréstimo" text="Cadastre o empréstimo (parcela, quantas e o dia): o site reconhece as parcelas pagas no extrato e mostra quando você fica livre."
          action={<Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setAdding(true)}>Cadastrar empréstimo</Button>} /></UiCard>
      )}

      <Sheet open={adding} onClose={close} title="Novo empréstimo">
        {adding && <div className="ls-form"><LoanForm l={NEW_LOAN()} onSave={saveLoan} onCancel={close} /></div>}
      </Sheet>
      <Sheet open={!!cur && !adding} onClose={close} title={cur?.l.name}>
        {cur && <div className="pat-detail"><LoanItem key={cur.l.id} l={cur.l} st={cur.st} months={months} setup={setup} single
          initial={entry.type === "prepay" ? "prepay" : null} /></div>}
      </Sheet>
    </div>
  );
}

type LStat = ReturnType<typeof loanStatus>;
const SIT: Record<LoanRow["status"], string> = { paga: "paga", adiantada: "adiantada", atrasada: "atrasada", aberta: "a vencer" };

// Um emprestimo: linha recolhida com o resumo; aberto mostra as acoes (pagar, adiantar, alterar) e as parcelas
function LoanItem({ l, st, months, setup, single, initial }: {
  l: Loan; st: LStat; months: Record<string, MonthDoc>; setup: GastosSetup; single: boolean; initial: "prepay" | "edit" | null;
}) {
  const [open, setOpen] = useState(single || !!initial || st.late > 0);
  const [mode, setMode] = useState<string | null>(initial); // "pay:k" | "prepay" | "edit"
  const [all, setAll] = useState(false);
  // ao abrir pagar/adiantar/alterar (ex.: "pagar" na parcela 16, la embaixo), leva a tela ate o formulario
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mode) panel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [mode]);
  const rows = st.rows;
  const first = rows.findIndex((r) => r.status === "atrasada" || r.status === "aberta");
  // recolhido: as 2 ultimas pagas, as atrasadas e as 4 proximas
  const shown = all ? rows : rows.filter((r, i) => r.status === "atrasada" || (first >= 0 ? i >= first - 2 && i < first + 4 : i >= rows.length - 3));
  const toggle = (m: string) => setMode(mode === m ? null : m);
  const undoPay = async (k: number) => {
    const p = (l.pays ?? []).find((x) => x.k === k);
    if (!p || !await ask(`Desfazer o pagamento da parcela ${k + 1}?`)) return;
    if (p.gid && p.gm && months[p.gm]) await saveMonth(p.gm, months[p.gm].items.filter((g) => g.id !== p.gid));
    await saveSetup({ loans: setup.loans.map((x) => (x.id === l.id ? { ...x, pays: (x.pays ?? []).filter((y) => y.k !== k) } : x)) });
  };
  const remove = async () => {
    if (await ask(`Remover ${l.name}? (os lançamentos na conta continuam)`)) await saveSetup({ loans: setup.loans.filter((x) => x.id !== l.id) });
  };
  // marca de uma vez as atrasadas como pagas (sem lancar saida): para quem cadastra um emprestimo antigo
  const markLate = async () => {
    const late = st.rows.filter((r) => r.status === "atrasada");
    if (!await ask(`Marcar as ${late.length} parcelas atrasadas como pagas? Não lança saída em nenhuma conta.`)) return;
    const add = late.map((r) => ({ k: r.k, d: r.due, v: l.parcela }));
    await saveSetup({ loans: setup.loans.map((x) => (x.id === l.id ? { ...x, pays: [...(x.pays ?? []), ...add] } : x)) });
  };
  const saveLoan = async (nl: Loan) => { await saveSetup({ loans: setup.loans.map((x) => (x.id === l.id ? nl : x)) }); setMode(null); };
  return (
    <div className={`loan${open ? " open" : ""}`}>
      <button className="loan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="loan-caret" aria-hidden>{open ? "\u25BE" : "\u25B8"}</span>
        <span className="loan-name"><b>{l.name}</b><small className="muted">{st.paid} de {l.n} pagas - saldo {brl(st.saldo, 0)}</small></span>
        <span className="loan-badge small">
          {st.late > 0 ? <span className="warn">{st.late} {st.late > 1 ? "atrasadas" : "atrasada"}</span>
            : st.next ? <span className="muted">próxima {dm(st.next)} - {brl(l.parcela, 0)}</span> : <span className="pos">quitado</span>}
        </span>
      </button>
      {open && (
        <div className="loan-body">
          <div className="limit">
            <span className="limit-fill paid" style={{ width: `${(st.paid / l.n) * 100}%` }} />
            <small className="muted">{st.paid} de {l.n} parcelas pagas{st.prepaid ? ` (${st.prepaid} adiantadas)` : ""} - {st.left > 0 ? `termina em ${monthLabel(st.end, true)}` : "quitado"}
              {st.left > 0 && st.end !== st.originalEnd ? ` (era ${monthLabel(st.originalEnd, true)})` : ""}
              {" "}- parcela {brl(l.parcela)} dia {l.dueDay}{l.rate ? `, juros ${fmt(l.rate)}% ao mês` : ""}</small>
          </div>
          {st.saved > 0.005 && <p className="small pos">Economizou {brl(st.saved)} adiantando parcelas</p>}
          <div className="row wrapline loan-actions">
            {st.nextK !== null && <button className={mode === `pay:${st.nextK}` ? "primary" : "ghost small-btn"} onClick={() => toggle(`pay:${st.nextK}`)}>
              Pagar parcela {st.nextK + 1}</button>}
            {st.left > 0 && <button className={mode === "prepay" ? "primary" : "ghost small-btn"} onClick={() => toggle("prepay")}>Adiantar parcelas</button>}
            {st.late > 1 && <button className="ghost small-btn" onClick={markLate}>Marcar {st.late} atrasadas como pagas</button>}
            <button className={mode === "edit" ? "primary" : "ghost small-btn"} onClick={() => toggle("edit")}>Alterar</button>
            <button className="ghost small-btn" onClick={remove}>Remover</button>
          </div>
          <div ref={panel} className="loan-panel">
          {mode?.startsWith("pay:") && <PayForm key={mode} l={l} k={Number(mode.slice(4))} months={months} setup={setup} onDone={() => setMode(null)} />}
          {mode === "prepay" && <PrepayForm setup={setup} loanId={l.id} onPick={() => undefined} />}
          {mode === "edit" && <LoanForm l={l} onSave={saveLoan} onCancel={() => setMode(null)} />}
          </div>

          <div className="table-scroll">
            <table className="loan-rows">
              <thead><tr><th>Parcela</th><th>Valor</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.k} className={r.status === "atrasada" ? "late" : r.k === st.nextK ? "nextrow" : ""}>
                    <td><span className="cell">{r.k + 1}/{l.n}<small className="muted">vence {dm(r.due)}/{r.due.slice(2, 4)}</small></span></td>
                    <td data-label="Valor">{brl(r.v ?? l.parcela)}</td>
                    <td data-label="Situação"><span className={`sit sit-${r.status}`}>{SIT[r.status]}</span>
                      {r.via === "extrato" && <small className="muted"> pelo extrato</small>}
                      {r.via === "voce" && r.d && <small className="muted"> em {dm(r.d)}</small>}</td>
                    <td className="actions">
                      {(r.status === "atrasada" || r.status === "aberta") && <button className="link" onClick={() => toggle(`pay:${r.k}`)}>pagar</button>}
                      {r.via === "voce" && <button className="link" onClick={() => undoPay(r.k)}>desfazer</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length || all ? <button className="link small" onClick={() => setAll(!all)}>{all ? "mostrar menos" : `ver todas as ${l.n} parcelas`}</button> : null}
        </div>
      )}
    </div>
  );
}

// Pagar uma parcela: quanto, quando e de qual conta (lanca a saida na conta) - ou so marcar como paga
function PayForm({ l, k, months, setup, onDone }: { l: Loan; k: number; months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void }) {
  const accounts = accountsOf(setup);
  const [v, setV] = useState(fmt(l.parcela));
  const [d, setD] = useState(todayBR());
  const [acc, setAcc] = useState(accounts[0]?.id ?? "");
  const num = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = num(v);
    if (!(val > 0)) return;
    const pay: NonNullable<Loan["pays"]>[number] = { k, d, v: Math.round(val * 100) / 100 };
    if (acc) {
      const gm = monthOf(d), gid = newId();
      const g: Gasto = { id: gid, d, desc: `${l.name} (parcela ${k + 1}/${l.n})`, v: pay.v, tipo: "gasto", cat: "Emprestimos", src: "emprestimo", ref: l.id, parc: [k + 1, l.n], acc };
      await saveMonth(gm, [...(months[gm]?.items ?? []), g]);
      pay.gid = gid; pay.gm = gm;
    }
    await saveSetup({ loans: setup.loans.map((x) => (x.id === l.id ? { ...x, pays: [...(x.pays ?? []).filter((y) => y.k !== k), pay] } : x)) });
    onDone();
  };
  const due = loanDue(l, k);
  return (
    <form className="fin-form loan-pay" onSubmit={save}>
      <p className="small"><b>Parcela {k + 1}/{l.n}</b> <span className="muted">vence {dm(due)}/{due.slice(2, 4)}</span></p>
      <div className="row wrapline">
        <label>Quanto pagou (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        <label>Quando<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label>De qual conta
          <select value={acc} onChange={(e) => setAcc(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="">não lançar saída (já está no extrato / paguei por fora)</option>
          </select>
        </label>
        <button className="primary" type="submit">Pagar</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
      <p className="muted small">{acc ? "Lança a saída nessa conta (categoria Empréstimos) e marca a parcela como paga." : "Só marca a parcela como paga; o saldo da conta não muda."}
        {num(v) > l.parcela * 1.005 ? ` Pagou ${brl(num(v) - l.parcela)} a mais (juros/multa?).` : ""}</p>
    </form>
  );
}

// Fatura em destaque (amostra aprovada): total grande, barra do planejado, fecha/vence, Pagar fatura e Nova compra; embaixo as compras
function FaturaView({ card, st, fm, setFm, months, setup, onBuy }: {
  card: Card; st: ReturnType<typeof cardStatus>; fm: string; setFm: (m: string) => void; months: Record<string, MonthDoc>; setup: GastosSetup; onBuy: () => void;
}) {
  const f = st.all.find((x) => x.m === fm);
  const best = bestBuy(card);
  const [paying, setPaying] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = faturaItems(card, months, fm);
  const total = f?.v ?? 0;
  const byCat: Record<string, number> = {};
  for (const { g } of list) if (g.tipo !== "receita") byCat[g.cat] = (byCat[g.cat] ?? 0) + g.v;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...cats.map(([, v]) => v), 0);
  const futuro = f?.futuro ?? 0;
  // Vale para todas as parcelas da compra (cada parcela fica gravada no mes dela)
  const setCat = async (g: Gasto, cat: string) => {
    const by: Record<string, Set<string>> = {};
    for (const { m, x } of parcelSiblings(months, g)) (by[m] ??= new Set()).add(x.id);
    // compra que vira "nao conta" (ex.: Emprestei dinheiro) continua sendo compra: saiu
    await Promise.all(Object.entries(by).map(([m, ids]) => saveMonth(m, months[m].items.map((x) => (ids.has(x.id)
      ? { ...x, cat, tipo: tipoOfCat(cat) ?? x.tipo, ...(tipoOfCat(cat) === "neutro" ? { io: x.io ?? "out" } : {}) } : x)))));
  };
  const remove = async (m: string, id: string, desc: string) => {
    if (!await ask(`Apagar "${desc}"?`)) return;
    await saveMonth(m, months[m].items.filter((x) => x.id !== id));
  };
  const pct = card.budget ? total / card.budget : null;
  const cur = list.find((x) => x.g.id === openId);
  const shown = all ? list : list.slice(0, 12);
  return (
    <>
      <section className="pat-fatura">
        <div className="pat-fatura-head">
          <Button variant="icon" size="sm" aria-label="Fatura anterior" icon={<ChevronLeft size={16} aria-hidden="true" />} onClick={() => setFm(addMonths(fm, -1))} />
          <span className="pat-fatura-title">Fatura de {monthLabel(fm, true).replace(/ de \d{4}$/, "")}{f ? ` · ${STATUS[f.status]}` : ""}</span>
          <Button variant="icon" size="sm" aria-label="Próxima fatura" icon={<ChevronRight size={16} aria-hidden="true" />} onClick={() => setFm(addMonths(fm, 1))} />
          {pct !== null && <Badge tone={pct > 1 ? "neg" : pct >= 0.8 ? "warn" : "neutral"}>{fmt(pct * 100, 0)}% do planejado</Badge>}
        </div>
        <div className="pat-fatura-v"><Money value={total} size="xl" /></div>
        {card.budget ? <Progress value={pct!} label="Usado do planejado" /> : null}
        <div className="pat-fatura-foot">
          <span>{card.budget ? `planejado ${brl(card.budget, 0)}` : "sem valor planejado"}</span>
          <span>{f ? `fecha ${dm(f.close)} · vence ${dm(f.due)}` : "sem compras"}</span>
        </div>
        {f && (f.paid > 0.005 || futuro > 0) && <p className="pat-fatura-note">{f.paid > 0.005 ? `pago ${brl(f.paid)}${f.status !== "paga" ? `, falta ${brl(f.rest)}` : ""}` : ""}{f.paid > 0.005 && futuro > 0 ? " · " : ""}{futuro > 0 ? `inclui ${brl(futuro)} de parcelas previstas` : ""}</p>}
        <div className="pat-fatura-acts">
          {f && f.status !== "paga" && <Button variant="primary" onClick={() => setPaying(true)}>Pagar fatura</Button>}
          <Button onClick={onBuy}>Nova compra</Button>
        </div>
      </section>
      {(best || card.limit) && <p className="mes-line">{best ? <>Melhor dia para comprar: <b>dia {best.day}</b> (próximo {dm(best.d)}, paga em {dm(best.due)}, {best.prazo} dias)</> : null}
        {best && card.limit ? " · " : ""}{card.limit ? <>limite usado <b>{fmt((st.open / card.limit) * 100, 0)}%</b> ({brl(st.open, 0)} de {brl(card.limit, 0)})</> : null}</p>}

      <Section title="Compras desta fatura" action={<span>{list.length} {list.length === 1 ? "compra" : "compras"}</span>}>
        {list.length ? (
          <List>
            {shown.map(({ g }) => (
              <ListRow key={g.id} onClick={() => setOpenId(g.id)} chevron={false} title={g.desc}
                sub={[dm(g.d), catLabel(g.cat), g.parc ? `${g.parc[0]} de ${g.parc[1]}` : null, g.sub ? "todo mês" : null].filter(Boolean).join(" · ")}
                value={<span className={g.tipo === "receita" ? "pos" : ""}>{g.tipo === "receita" ? "+" : ""}{brl(g.v)}</span>} />
            ))}
            {list.length > shown.length && <button type="button" className="mes-list-more" onClick={() => setAll(true)}>ver as {list.length} compras</button>}
          </List>
        ) : <UiCard><p className="mes-empty">Nenhuma compra lançada nesta fatura.</p></UiCard>}
      </Section>

      {cats.length > 1 && (
        <Fold title="Por categoria nesta fatura">
          <UiCard>
            <div className="hbars">
              {cats.map(([c, v]) => (
                <div key={c} className="hbar" title={`${catLabel(c)}: ${brl(v)}`}>
                  <span className="hbar-label small">{catLabel(c)}</span>
                  <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(v / maxCat) * 100}%` }} /></span>
                  <span className="hbar-value small">{fmt(v, 0)} <span className="muted">{total > 0 ? `${fmt((v / total) * 100, 0)}%` : ""}</span></span>
                </div>
              ))}
            </div>
          </UiCard>
        </Fold>
      )}

      <Sheet open={paying && !!f} onClose={() => setPaying(false)} title={`Pagar a fatura de ${monthLabel(fm)}`}>
        {paying && f && <div className="ls-form"><CardPayForm key={fm} card={card} fm={fm} rest={f.rest} due={f.due} months={months} setup={setup} onDone={() => setPaying(false)} /></div>}
      </Sheet>
      <Sheet open={!!cur} onClose={() => setOpenId(null)} title={cur?.g.sub ? "Assinatura" : "Compra no cartão"}>
        {cur && (
          <div className="item-sheet">
            <div className="item-top">
              <b className="item-desc">{cur.g.desc}</b>
              <span className="ui-money size-lg">{brl(cur.g.v)}</span>
              <span className="item-sub">{new Date(`${cur.g.d}T12:00:00`).toLocaleDateString("pt-BR")} · {card.name}{cur.g.parc ? ` · parcela ${cur.g.parc[0]} de ${cur.g.parc[1]}` : ""}</span>
            </div>
            {cur.g.sub ? (card.subs ?? []).filter((x) => x.id === cur.g.sub).map((x) => <EditSub key={x.id} sub={x} card={card} setup={setup} onDone={() => setOpenId(null)} />) : <>
              <div className="item-cat">
                <p className="ls-label">Categoria{cur.g.parc ? " (vale para todas as parcelas)" : ""}</p>
                <CatSelect value={cur.g.cat} onChange={(c) => setCat(cur.g, c)} dir="out" />
                {cur.g.cat === RECV_OUT_CAT && <RecvSelect g={cur.g} m={cur.m} months={months} setup={setup} />}
              </div>
              <EditBuy key={cur.g.id} g={cur.g} months={months} setup={setup} onDone={() => setOpenId(null)} />
              <Button variant="danger" size="sm" className="pay-remove" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => remove(cur.m, cur.g.id, cur.g.desc)}>Apagar a compra</Button>
            </>}
          </div>
        )}
      </Sheet>
    </>
  );
}

// Proximos 12 meses de uma parte so: faturas (com parcelas) ou parcelas de emprestimo
function CommitmentsChart({ data, which }: { data: Com; which: "cards" | "loans" }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = (x: Com[number]) => x[which];
  const max = Math.max(...data.map(val), 0);
  if (!(max > 0)) return null;
  const h = hover !== null ? data[hover] : null;
  const what = which === "cards" ? "faturas" : "parcelas";
  return (
    <section className="card">
      <h2>{which === "cards" ? "Faturas" : "Parcelas"} nos próximos 12 meses</h2>
      <figure className="viz">
        <figcaption className="small muted">{h ? <>{monthLabel(h.m)}: {what} <b className="ink">{brl(val(h))}</b></>
          : (() => { const top = data.reduce((a, b) => (val(b) > val(a) ? b : a)); const tot = data.reduce((t, x) => t + val(x), 0);
            return <>Total em 12 meses <b className="ink">{brl(tot)}</b> - maior mês: {monthLabel(top.m)} ({brl(val(top))}). Toque ou passe o mouse numa barra.</>; })()}</figcaption>
        <div className="mbars twelve" onMouseLeave={() => setHover(null)}>
          {data.map((x, i) => (
            <div key={x.m} className={`mbar${hover !== null && hover !== i ? " dim" : ""}`} onMouseEnter={() => setHover(i)} title={`${monthLabel(x.m)}: ${brl(val(x))}`}>
              <span className="stack-col"><span className={`mbar-fill ${which === "cards" ? "k-cards" : "k-loans"}`} style={{ height: `${(val(x) / max) * 100}%` }} /></span>
              <small>{monthLabel(x.m).slice(0, 3)}<span className="yr">{monthLabel(x.m).slice(3)}</span></small>
            </div>
          ))}
        </div>
      </figure>
      <Note>{which === "cards" ? "Faturas futuras somam as parcelas que ainda vem; compras novas aumentam esses valores." : "Parcelas adiantadas já saem daqui. Para mudar quais meses o adiantamento cobre, use \"Adiantar parcelas\"."}</Note>
    </section>
  );
}

// Adiantar parcelas: quantas, quando e quanto pagou (com desconto); lista e desfaz os adiantamentos
function PrepayForm({ setup, loanId, onPick }: { setup: GastosSetup; loanId: string; onPick: (id: string) => void }) {
  const loan = setup.loans.find((l) => l.id === loanId) ?? setup.loans[0];
  const st = loanStatus(loan);
  const [d, setD] = useState(todayBR());
  const [n, setN] = useState("1");
  const [v, setV] = useState("");
  const [from, setFrom] = useState("fim");
  const nextM = st.next ? monthOf(st.next) : monthOf(todayBR());
  const num = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
  const qty = Math.max(1, Math.round(num(n)));
  const paidV = num(v) > 0 ? num(v) : qty * loan.parcela;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qty > st.left) return await tell(`Só restam ${st.left} parcelas.`);
    const prepay = [...(loan.prepay ?? []), { id: newId(), d, n: qty, v: Math.round(paidV * 100) / 100, from: from === "next" ? nextM : from }];
    await saveSetup({ loans: setup.loans.map((l) => (l.id === loan.id ? { ...l, prepay } : l)) });
    setN("1"); setV(""); setFrom("fim");
  };
  const setPFrom = async (pid: string, f: string) => {
    await saveSetup({ loans: setup.loans.map((l) => (l.id === loan.id ? { ...l, prepay: (l.prepay ?? []).map((p) => (p.id === pid ? { ...p, from: f } : p)) } : l)) });
  };
  // meses do contrato para escolher "a partir de"
  const monthsOpt = Array.from({ length: loan.n }, (_, k) => addMonths(loan.first, k));
  const slots = prepaidSlots(loan);
  const covered = (pid: string) => [...slots].filter(([, id]) => id === pid).map(([k]) => k).sort((a, b) => a - b);
  const range = (ks: number[]) => ks.length ? `${monthLabel(addMonths(loan.first, ks[0]))}${ks.length > 1 ? ` a ${monthLabel(addMonths(loan.first, ks[ks.length - 1]))}` : ""}` : "-";
  const undo = async (pid: string) => {
    if (!await ask("Desfazer este adiantamento?")) return;
    await saveSetup({ loans: setup.loans.map((l) => (l.id === loan.id ? { ...l, prepay: (l.prepay ?? []).filter((p) => p.id !== pid) } : l)) });
  };
  return (
    <form className="fin-form" onSubmit={save}>
      <div className="row wrapline">
        <label>Empréstimo
          <select value={loan.id} onChange={(e) => onPick(e.target.value)}>{setup.loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label>Quantas parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 80 }} /></label>
        <label>Quanto pagou (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder={fmt(qty * loan.parcela)} /></label>
        <label>Quais parcelas
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="fim">as últimas (termina antes)</option>
            <option value="next">as próximas ({monthLabel(nextM)} em diante)</option>
            {monthsOpt.map((m) => <option key={m} value={m}>a partir de {monthLabel(m, true)}</option>)}
          </select>
        </label>
        <button className="primary" type="submit">Adiantar</button>
      </div>
      <p className="muted small">
        {qty} x {brl(loan.parcela)} = {brl(qty * loan.parcela)}{num(v) > 0 && num(v) < qty * loan.parcela ? ` - desconto de ${brl(qty * loan.parcela - num(v))}` : ""}.
        {from === "fim" ? <>As últimas parcelas saem do contrato: termina em {monthLabel(addMonths(st.end, -qty), true)} (hoje: {monthLabel(st.end, true)}).</>
          : <>Esses meses ficam sem parcela; o fim do contrato não muda.</>}
        O pagamento em si entra pelo extrato da conta (categoria Empréstimos).
      </p>
      {(loan.prepay ?? []).length > 0 && (
        <ul className="pend small">
          {loan.prepay!.map((p) => (
            <li key={p.id}><span className="muted">{dm(p.d)}</span> <b>{p.n} {p.n > 1 ? "parcelas adiantadas" : "parcela adiantada"}</b>
              <span>{brl(p.v)}</span>
              <span className="muted">cobre {range(covered(p.id))}</span>
              <select className="pay-sel" value={!p.from || p.from === "fim" ? "fim" : p.from} onChange={(e) => setPFrom(p.id, e.target.value)} aria-label="Quais parcelas">
                <option value="fim">as últimas</option>
                {monthsOpt.map((m) => <option key={m} value={m}>a partir de {monthLabel(m, true)}</option>)}
              </select>
              <button className="link" type="button" onClick={() => undo(p.id)}>desfazer</button></li>
          ))}
        </ul>
      )}
    </form>
  );
}

// Faturas do cartao, uma por linha (como as parcelas do emprestimo): valor, pago, situacao e o botao pagar
function FaturasList({ card, st, fm, setFm, months, setup }: {
  card: Card; st: ReturnType<typeof cardStatus>; fm: string; setFm: (m: string) => void; months: Record<string, MonthDoc>; setup: GastosSetup;
}) {
  const [all, setAll] = useState(false);
  const [pay, setPay] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pay) panel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [pay]);
  const rows = st.all;
  if (!rows.length) return null;
  const today = todayBR();
  // recolhido: as atrasadas, as 2 ultimas pagas e as 4 proximas
  const firstOpen = rows.findIndex((r) => r.status !== "paga");
  const shown = all ? rows : rows.filter((r, i) => r.status === "vencida" || (firstOpen >= 0 ? i >= firstOpen - 2 && i < firstOpen + 4 : i >= rows.length - 3));
  const late = rows.filter((r) => r.status === "vencida");
  const pays = card.pays ?? [];
  const undo = async (fmx: string) => {
    const mine = pays.filter((p) => p.fm === fmx);
    if (!mine.length || !await ask(`Desfazer o pagamento da fatura de ${monthLabel(fmx)}?`)) return;
    for (const p of mine) if (p.gid && p.gm && months[p.gm]) await saveMonth(p.gm, months[p.gm].items.filter((g) => g.id !== p.gid));
    await saveSetup({ cards: setup.cards.map((c) => (c.id === card.id ? { ...c, pays: (c.pays ?? []).filter((p) => p.fm !== fmx) } : c)) });
  };
  const pf = pay ? rows.find((r) => r.m === pay) : null;
  return (
    <section className="card">
      <div className="card-head"><h2>Faturas do {card.name}</h2>
        {late.length > 0 && <span className="warn small">{late.length} {late.length > 1 ? "atrasadas" : "atrasada"} - {brl(late.reduce((s, r) => s + r.rest, 0))}</span>}</div>
      <div ref={panel} className="loan-panel">
        {pf && <CardPayForm key={pf.m} card={card} fm={pf.m} rest={pf.rest} due={pf.due} months={months} setup={setup} onDone={() => setPay(null)} />}
      </div>
      <div className="table-scroll">
        <table className="loan-rows">
          <thead><tr><th>Fatura</th><th>Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => {
              const mine = pays.filter((p) => p.fm === r.m);
              return (
                <tr key={r.m} className={r.status === "vencida" ? "late" : r.m === fm ? "nextrow" : ""}>
                  <td><span className="cell"><button className="link" onClick={() => setFm(r.m)} title="ver as compras">{monthLabel(r.m)}</button>
                    <small className="muted">vence {dm(r.due)}{r.futuro > 0 ? " - parcelas" : ""}</small></span></td>
                  <td data-label="Valor">{brl(r.v)}{r.paid > 0.005 && r.status !== "paga" && <small className="muted"> falta {brl(r.rest)}</small>}</td>
                  <td data-label="Situação"><span className={`sit sit-${FSIT[r.status].cls}`}>{FSIT[r.status].label}</span>
                    {mine.length > 0 && <small className="muted"> em {dm(mine[mine.length - 1].d)}</small>}
                    {r.status === "paga" && !mine.length && <small className="muted"> pelo extrato</small>}</td>
                  <td className="actions">
                    {r.status !== "paga" && r.due.slice(0, 7) <= addMonths(monthOf(today), 1) && <button className="link" onClick={() => setPay(pay === r.m ? null : r.m)}>pagar</button>}
                    {mine.length > 0 && <button className="link" onClick={() => undo(r.m)}>desfazer</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length || all ? <button className="link small" onClick={() => setAll(!all)}>{all ? "mostrar menos" : `ver todas as ${rows.length} faturas`}</button> : null}
    </section>
  );
}

// Pagar a fatura: quanto, quando e de qual conta (lanca a saida na conta) - ou so marcar como paga
export function CardPayForm({ card, fm, rest, due, months, setup, onDone }: {
  card: Card; fm: string; rest: number; due: string; months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void;
}) {
  const accounts = accountsOf(setup);
  const [v, setV] = useState(fmt(rest));
  const [d, setD] = useState(todayBR());
  const [acc, setAcc] = useState(accounts[0]?.id ?? "");
  const num = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.round(num(v) * 100) / 100;
    if (!(val > 0)) return;
    const pay: NonNullable<Card["pays"]>[number] = { id: newId(), fm, d, v: val };
    if (acc) {
      const gm = monthOf(d), gid = newId();
      const g: Gasto = { id: gid, d, desc: `Fatura ${card.name} (${monthLabel(fm)})`, v: val, tipo: "neutro", cat: CARD_PAY_CAT, io: "out", payCard: card.id, acc };
      await saveMonth(gm, [...(months[gm]?.items ?? []), g]);
      pay.gid = gid; pay.gm = gm;
    }
    await saveSetup({ cards: setup.cards.map((c) => (c.id === card.id ? { ...c, pays: [...(c.pays ?? []), pay] } : c)) });
    onDone();
  };
  return (
    <form className="fin-form loan-pay" onSubmit={save}>
      <p className="small"><b>Fatura {card.name} - {monthLabel(fm)}</b> <span className="muted">vence {dm(due)}, falta {brl(rest)}</span></p>
      <div className="row wrapline">
        <label>Quanto pagou (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        <label>Quando<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label>De qual conta
          <select value={acc} onChange={(e) => setAcc(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="">não lançar saída (já está no extrato / paguei por fora)</option>
          </select>
        </label>
        <button className="primary" type="submit">Pagar</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
      <p className="muted small">{acc ? "Lança a saída nessa conta (categoria Fatura do cartão) e abate desta fatura." : "Só abate desta fatura; o saldo da conta não muda."}
        {num(v) > 0 && num(v) < rest - 0.005 ? ` Pagamento parcial: ficam ${brl(rest - num(v))} em aberto.` : ""}</p>
    </form>
  );
}

// Alterar uma compra no cartao: data, descricao, valor e cartao. Parcelada: vale para todas as parcelas da compra
// (as datas andam juntas, uma por mes). A categoria muda direto na lista.
function EditBuy({ g, months, setup, onDone }: { g: Gasto; months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void }) {
  // todas as parcelas da mesma compra (mesmo cartao, descricao, valor e numero de parcelas), com o mes onde estao gravadas
  const siblings: { m: string; x: Gasto }[] = [];
  for (const [m, md] of Object.entries(months))
    for (const x of md.items)
      if (x.id === g.id || (g.parc && x.parc && x.card === g.card && x.parc[1] === g.parc[1] && descKey(x.desc) === descKey(g.desc) && Math.abs(x.v - g.v) < 0.01))
        siblings.push({ m, x });
  const many = siblings.length > 1;
  const [d, setD] = useState(g.d);
  const [desc, setDesc] = useState(g.desc);
  const [v, setV] = useState(fmt(g.v));
  const [card, setCard] = useState(g.card ?? "");
  const [all, setAll] = useState(many);
  const [busy, setBusy] = useState(false);
  const num = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
  const targets = all ? siblings : siblings.filter((s) => s.x.id === g.id);
  // grava: tira cada parcela do mes antigo e poe no mes da nova data
  const write = async (change: ((x: Gasto) => Gasto) | null) => {
    const work: Record<string, Gasto[]> = {};
    const get = (m: string) => (work[m] ??= [...(months[m]?.items ?? [])]);
    for (const { m, x } of targets) {
      work[m] = get(m).filter((y) => y.id !== x.id);
      if (change) { const nx = change(x); get(monthOf(nx.d)).push(nx); }
    }
    for (const [m, items] of Object.entries(work)) await saveMonth(m, items);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.round(num(v) * 100) / 100;
    if (!desc.trim() || !(val > 0) || !card) return;
    setBusy(true);
    const day = Number(d.slice(8, 10));
    await write((x) => {
      const off = x.parc && g.parc ? x.parc[0] - g.parc[0] : 0;
      const nd = x.id === g.id ? d : dayIn(addMonths(monthOf(d), off), day);
      return { ...x, d: nd, desc: desc.trim(), v: val, card };
    });
    setBusy(false);
    onDone();
  };
  const removeAll = async () => {
    if (!await ask(`Apagar as ${siblings.length} parcelas de "${g.desc}"?`)) return;
    setAll(true);
    const work: Record<string, Gasto[]> = {};
    for (const { m, x } of siblings) work[m] = (work[m] ?? [...(months[m]?.items ?? [])]).filter((y) => y.id !== x.id);
    for (const [m, items] of Object.entries(work)) await saveMonth(m, items);
    onDone();
  };
  return (
    <form className="fin-form loan-pay" onSubmit={save}>
      <div className="row wrapline">
        <label>Data{many && all ? " desta parcela" : ""}<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="grow">Descrição<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label>{many ? "Valor da parcela" : "Valor"} (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        <label>Cartão
          <select value={card} onChange={(e) => setCard(e.target.value)}>{setup.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
      </div>
      {many && (
        <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          aplicar nas {siblings.length} parcelas desta compra (as datas mudam juntas, uma por mês)</label>
      )}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>Salvar</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
        {many && <button className="ghost small-btn" type="button" onClick={removeAll}>apagar a compra inteira ({siblings.length} parcelas)</button>}
      </div>
    </form>
  );
}

// Assinaturas do cartao: cobradas sozinhas em cada fatura ate cancelar
function SubsList({ card, setup }: { card: Card; setup: GastosSetup }) {
  const [edit, setEdit] = useState<string | null>(null);
  const subs = card.subs ?? [];
  if (!subs.length) return null;
  const cur = monthOf(todayBR());
  const ativas = subs.filter((s) => !s.end || s.end >= cur);
  return (
    <section className="card">
      <div className="card-head"><h2>Assinaturas</h2><span className="muted small">{brl(ativas.reduce((t, s) => t + subValue(s, cur), 0))} por mês</span></div>
      <ul className="pend small">
        {subs.map((s) => (
          <li key={s.id} className={s.end && s.end < cur ? "muted" : ""}>
            <span className="muted">dia {s.day}</span> <b>{s.desc}</b> <span className="muted">{catLabel(s.cat)} - desde {monthLabel(s.start)}</span>
            {s.end && <span className="tag">{s.end < cur ? "cancelada" : "até"} {monthLabel(s.end)}</span>}
            <span>{brl(subValue(s, cur))}</span>
            <button className="link" onClick={() => setEdit(edit === s.id ? null : s.id)}>alterar</button>
            {edit === s.id && <div className="sub-edit"><EditSub sub={s} card={card} setup={setup} onDone={() => setEdit(null)} /></div>}
          </li>
        ))}
      </ul>
      <Note>Para cadastrar outra: em &quot;Compra no cartão&quot;, marque &quot;Assinatura&quot;. Mudar o valor vale do mês atual em diante; as faturas antigas ficam como estão.</Note>
    </section>
  );
}

function EditSub({ sub, card, setup, onDone }: { sub: CardSub; card: Card; setup: GastosSetup; onDone: () => void }) {
  const cur = monthOf(todayBR());
  const curV = subValue(sub, cur);
  const [desc, setDesc] = useState(sub.desc);
  const [v, setV] = useState(fmt(curV));
  const [day, setDay] = useState(String(sub.day));
  const [cat, setCat] = useState(sub.cat);
  const [end, setEnd] = useState(sub.end ?? "");
  const [busy, setBusy] = useState(false);
  const num = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
  const write = async (subs: CardSub[]) => { await saveSetup({ cards: setup.cards.map((c) => (c.id === card.id ? { ...c, subs: JSON.parse(JSON.stringify(subs)) } : c)) }); onDone(); };
  const others = (card.subs ?? []).filter((x) => x.id !== sub.id);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.round(num(v) * 100) / 100;
    if (!desc.trim() || !(val > 0)) return;
    setBusy(true);
    const { end: _e, ...rest } = sub;
    void _e;
    const steps = Math.abs(val - curV) > 0.005 ? [...(sub.steps ?? []).filter((x) => x.from !== cur), { from: cur, v: val }] : sub.steps;
    await write([...others, { ...rest, desc: desc.trim(), cat, day: Math.max(1, Math.min(31, Math.round(num(day)) || sub.day)), ...(steps ? { steps } : {}), ...(end ? { end } : {}) }]);
  };
  const remove = async () => {
    if (await ask(`Apagar a assinatura ${sub.desc}? Ela sai também das faturas passadas. Para só parar de cobrar, use "Último mês".`)) await write(others);
  };
  const opts = Array.from({ length: 25 }, (_, i) => addMonths(cur, i - 6)).filter((m) => m >= sub.start);
  return (
    <form className="fin-form loan-pay" onSubmit={save}>
      <div className="row wrapline">
        <label className="grow">Descrição<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label>Valor por mês (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        <label>Dia<input value={day} inputMode="numeric" onChange={(e) => setDay(e.target.value)} style={{ width: 60 }} /></label>
        <label>Categoria<CatSelect value={cat} onChange={setCat} dir="out" /></label>
        <label>Último mês
          <select value={end} onChange={(e) => setEnd(e.target.value)}>
            <option value="">sem fim (ativa)</option>
            {end && !opts.includes(end) && <option value={end}>{monthLabel(end)}</option>}
            {opts.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
        <button className="ghost small-btn" type="button" onClick={remove}>apagar assinatura</button>
      </div>
    </form>
  );
}
