"use client";
import { useEffect, useRef, useState } from "react";
import {
  accountsOf, addMonths, cardStatus, commitments, debts, faturaItems, faturaMonth, loanDue, loanStatus, prepaidSlots, monthLabel, monthOf, newId, tipoOfCat, todayBR,
  type Card, type Gasto, type GastosSetup, type Loan, type LoanRow, type MonthDoc,
} from "@/lib/gastos";
import type { FinItem } from "@/lib/types";
import { CardForm, CatSelect, LoanForm, QuickAdd, saveMonth, saveSetup } from "./GastosCard";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export type CardsEntry = { type: "compra" | "card" | "loan" | "prepay"; id: string | null };
const TYPES: { id: CardsEntry["type"]; label: string }[] = [
  { id: "compra", label: "Compra no cartao" }, { id: "card", label: "Cadastrar cartao" },
];
const STATUS: Record<string, string> = { aberta: "aberta (ainda recebendo compras)", fechada: "fechada, a pagar", paga: "paga", vencida: "vencida sem pagamento" };

// Planejamento do cartao: fatura que esta recebendo compras agora x o planejado
export function budgetAlerts(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const out: { c: Card; used: number; pct: number }[] = [];
  for (const c of setup.cards) {
    if (!c.budget) continue;
    const fm = faturaMonth(c, todayBR());
    const f = cardStatus(c, months).all.find((x) => x.m === fm);
    const used = f?.v ?? 0;
    if (used >= c.budget * 0.8) out.push({ c, used, pct: used / c.budget });
  }
  return out;
}

// Sub-aba Cartoes e emprestimos, separada em duas partes: Cartoes | Emprestimos
const LOAN_TYPES: CardsEntry["type"][] = ["loan", "prepay"];
export default function CardsLoans({ months, setup, invest, entry, setEntry }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; entry: CardsEntry; setEntry: (e: CardsEntry) => void;
}) {
  const part: "cards" | "loans" = LOAN_TYPES.includes(entry.type) ? "loans" : "cards";
  const d = debts(months, setup);
  const com = commitments(months, setup);
  const nav = (
    <nav className="subtabs inner" role="tablist" aria-label="Cartoes e emprestimos">
      <button role="tab" aria-selected={part === "cards"} className={part === "cards" ? "pill on" : "pill"} onClick={() => setEntry({ type: "compra", id: null })}>
        Cartoes <span className="muted">{brl(d.cards, 0)}</span></button>
      <button role="tab" aria-selected={part === "loans"} className={part === "loans" ? "pill on" : "pill"} onClick={() => setEntry({ type: "loan", id: null })}>
        Emprestimos <span className="muted">{brl(d.loans, 0)}</span></button>
    </nav>
  );
  return (
    <>
      {nav}
      {part === "cards"
        ? <CardsPart months={months} setup={setup} invest={invest} entry={entry} setEntry={setEntry} owed={d.cards} com={com} />
        : <LoansPart months={months} setup={setup} entry={entry} owed={d.loans} com={com} />}
    </>
  );
}

type Com = { m: string; cards: number; loans: number }[];

function CardsPart({ months, setup, invest, entry, setEntry, owed, com }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; entry: CardsEntry; setEntry: (e: CardsEntry) => void; owed: number; com: Com;
}) {
  const cards = setup.cards;
  const [sel, setSel] = useState(cards[0]?.id ?? "");
  const card = cards.find((c) => c.id === sel) ?? cards[0];
  const st = card ? cardStatus(card, months) : null;
  const [fmSel, setFm] = useState<string | null>(null);
  const fm = fmSel ?? (card ? faturaMonth(card, todayBR()) : monthOf(todayBR()));
  const next = com[1];
  const planned = cards.reduce((s, c) => s + (c.budget ?? 0), 0);
  const usedNow = cards.reduce((s, c) => s + (cardStatus(c, months).all.find((f) => f.m === faturaMonth(c, todayBR()))?.v ?? 0), 0);
  return (
    <>
      <section className="card">
        <h2>Cartoes</h2>
        <div className="kpis">
          <div><span>Devendo nos cartoes</span><b className={owed > 0 ? "warn" : ""}>{brl(owed)}</b><small className="muted">faturas a pagar + parcelas futuras</small></div>
          <div><span>Faturas em {monthLabel(next.m)}</span><b>{brl(next.cards)}</b><small className="muted">ja comprometido</small></div>
          <div><span>Planejado nos cartoes</span><b>{planned ? brl(planned, 0) : "-"}</b>
            <small className={planned && usedNow > planned ? "warn" : "muted"}>{planned ? `usado ${brl(usedNow, 0)} nas faturas abertas (${fmt((usedNow / planned) * 100, 0)}%)` : "defina no cadastro do cartao"}</small></div>
        </div>
        <p className="muted small">As compras no cartao sao controladas aqui. Em Lancamentos (o extrato da conta), a fatura entra como uma saida so, no dia em que voce paga.</p>
      </section>

      <section className="card entry-card">
        <CardsEntryPanel months={months} setup={setup} invest={invest} entry={entry} setEntry={setEntry} />
      </section>

      {card && st && (
        <section className="card">
          <div className="card-head">
            <div className="kind-pick">
              {cards.map((c) => <button key={c.id} className={c.id === card.id ? "pill on" : "pill"} onClick={() => { setSel(c.id); setFm(null); }}>{c.name}</button>)}
            </div>
            <div className="month-nav">
              <button className="ghost icon" aria-label="Fatura anterior" onClick={() => setFm(addMonths(fm, -1))}>&lsaquo;</button>
              <h2>Fatura {monthLabel(fm)}</h2>
              <button className="ghost icon" aria-label="Proxima fatura" onClick={() => setFm(addMonths(fm, 1))}>&rsaquo;</button>
            </div>
          </div>
          <FaturaView card={card} st={st} fm={fm} months={months} setup={setup} />
        </section>
      )}

      <CommitmentsChart data={com} which="cards" />
    </>
  );
}

function LoansPart({ months, setup, entry, owed, com }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; entry: CardsEntry; owed: number; com: Com;
}) {
  const ctx = { months, setup };
  const sts = setup.loans.map((l) => ({ l, st: loanStatus(l, todayBR(), ctx) }));
  const active = sts.filter((x) => x.st.left > 0);
  const lastEnd = active.reduce((m, x) => (x.st.end > m ? x.st.end : m), "");
  const saved = sts.reduce((s, x) => s + x.st.saved, 0);
  const late = sts.reduce((s, x) => s + x.st.late, 0);
  // proxima parcela a pagar (a que vence primeiro entre todos os emprestimos)
  const nx = sts.filter((x) => x.st.next).sort((a, b) => a.st.next!.localeCompare(b.st.next!))[0];
  const lateV = sts.reduce((s, x) => s + x.st.lateV, 0);
  const [adding, setAdding] = useState(!setup.loans.length);
  const saveLoan = async (l: Loan) => {
    await saveSetup({ loans: setup.loans.some((x) => x.id === l.id) ? setup.loans.map((x) => (x.id === l.id ? l : x)) : [...setup.loans, l] });
    setAdding(false);
  };
  return (
    <>
      <section className="card">
        <h2>Emprestimos</h2>
        <div className="kpis">
          <div><span>Devendo em emprestimos</span><b>{brl(owed)}</b><small className="muted">saldo devedor de {active.length} {active.length === 1 ? "emprestimo" : "emprestimos"}</small></div>
          {late > 0 && <div><span>Parcelas atrasadas</span><b className="warn">{late} - {brl(lateV)}</b><small className="muted">venceram sem pagamento</small></div>}
          <div><span>Proxima parcela</span><b className={nx && nx.st.next! < todayBR() ? "warn" : ""}>{nx ? brl(nx.l.parcela) : "-"}</b>
            <small className="muted">{nx ? `${nx.st.nextK! + 1}/${nx.l.n}${sts.length > 1 ? ` ${nx.l.name}` : ""} - ${nx.st.next! < todayBR() ? "venceu" : "vence"} ${dm(nx.st.next!)}/${nx.st.next!.slice(2, 4)}` : "nenhuma"}</small></div>
          <div><span>Livre de emprestimos em</span><b>{lastEnd ? monthLabel(lastEnd, true) : "-"}</b><small className="muted">ultima parcela</small></div>
          {saved > 0.005 && <div><span>Economizou adiantando</span><b className="pos">{brl(saved)}</b></div>}
        </div>
        <p className="muted small">Abra o emprestimo para ver as parcelas. Parcela paga pelo extrato e reconhecida sozinha;
          se pagou e nao aparece, use &quot;pagar&quot;. Parcela vencida sem pagamento fica como atrasada.</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Seus emprestimos</h2>
          {!adding && <button className="ghost small-btn" onClick={() => setAdding(true)}>+ novo emprestimo</button>}</div>
        {adding && (
          <div className="loan-form">
            <LoanForm l={{ id: newId(), name: "", parcela: 0, n: 12, first: monthOf(todayBR()), dueDay: 10, paidBefore: 0 }} onSave={saveLoan} onCancel={() => setAdding(false)} />
          </div>
        )}
        {sts.map(({ l, st }) => (
          <LoanItem key={l.id} l={l} st={st} months={months} setup={setup} single={sts.length === 1}
            initial={entry.id === l.id ? (entry.type === "prepay" ? "prepay" : "edit") : null} />
        ))}
        {!sts.length && !adding && <p className="muted small">Nenhum emprestimo cadastrado.</p>}
      </section>

      <CommitmentsChart data={com} which="loans" />
    </>
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
    if (!p || !confirm(`Desfazer o pagamento da parcela ${k + 1}?`)) return;
    if (p.gid && p.gm && months[p.gm]) await saveMonth(p.gm, months[p.gm].items.filter((g) => g.id !== p.gid));
    await saveSetup({ loans: setup.loans.map((x) => (x.id === l.id ? { ...x, pays: (x.pays ?? []).filter((y) => y.k !== k) } : x)) });
  };
  const remove = async () => {
    if (confirm(`Remover ${l.name}? (os lancamentos na conta continuam)`)) await saveSetup({ loans: setup.loans.filter((x) => x.id !== l.id) });
  };
  // marca de uma vez as atrasadas como pagas (sem lancar saida): para quem cadastra um emprestimo antigo
  const markLate = async () => {
    const late = st.rows.filter((r) => r.status === "atrasada");
    if (!confirm(`Marcar as ${late.length} parcelas atrasadas como pagas? Nao lanca saida em nenhuma conta.`)) return;
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
            : st.next ? <span className="muted">proxima {dm(st.next)} - {brl(l.parcela, 0)}</span> : <span className="pos">quitado</span>}
        </span>
      </button>
      {open && (
        <div className="loan-body">
          <div className="limit">
            <span className="limit-fill paid" style={{ width: `${(st.paid / l.n) * 100}%` }} />
            <small className="muted">{st.paid} de {l.n} parcelas pagas{st.prepaid ? ` (${st.prepaid} adiantadas)` : ""} - {st.left > 0 ? `termina em ${monthLabel(st.end, true)}` : "quitado"}
              {st.left > 0 && st.end !== st.originalEnd ? ` (era ${monthLabel(st.originalEnd, true)})` : ""}
              {" "}- parcela {brl(l.parcela)} dia {l.dueDay}{l.rate ? `, juros ${fmt(l.rate)}% ao mes` : ""}</small>
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
              <thead><tr><th>Parcela</th><th>Valor</th><th>Situacao</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.k} className={r.status === "atrasada" ? "late" : r.k === st.nextK ? "nextrow" : ""}>
                    <td><span className="cell">{r.k + 1}/{l.n}<small className="muted">vence {dm(r.due)}/{r.due.slice(2, 4)}</small></span></td>
                    <td data-label="Valor">{brl(r.v ?? l.parcela)}</td>
                    <td data-label="Situacao"><span className={`sit sit-${r.status}`}>{SIT[r.status]}</span>
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
            <option value="">nao lancar saida (ja esta no extrato / paguei por fora)</option>
          </select>
        </label>
        <button className="primary" type="submit">Pagar</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
      <p className="muted small">{acc ? "Lanca a saida nessa conta (categoria Emprestimos) e marca a parcela como paga." : "So marca a parcela como paga; o saldo da conta nao muda."}
        {num(v) > l.parcela * 1.005 ? ` Pagou ${brl(num(v) - l.parcela)} a mais (juros/multa?).` : ""}</p>
    </form>
  );
}

function FaturaView({ card, st, fm, months, setup }: {
  card: Card; st: ReturnType<typeof cardStatus>; fm: string; months: Record<string, MonthDoc>; setup: GastosSetup;
}) {
  const f = st.all.find((x) => x.m === fm);
  const list = faturaItems(card, months, fm);
  const total = f?.v ?? 0;
  const byCat: Record<string, number> = {};
  for (const { g } of list) if (g.tipo === "gasto") byCat[g.cat] = (byCat[g.cat] ?? 0) + g.v;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...cats.map(([, v]) => v), 0);
  const futuro = f?.futuro ?? 0;
  const later = st.all.filter((x) => x.m > fm).slice(0, 6);
  const setCat = async (m: string, id: string, cat: string) => {
    const md = months[m];
    await saveMonth(m, md.items.map((x) => (x.id === id ? { ...x, cat, tipo: tipoOfCat(cat) ?? x.tipo } : x)));
  };
  const remove = async (m: string, id: string, desc: string) => {
    if (!confirm(`Apagar "${desc}"?`)) return;
    await saveMonth(m, months[m].items.filter((x) => x.id !== id));
  };
  return (
    <>
      <p className="small">
        Fecha em <b>{f ? dm(f.close) : "-"}</b>, vence em <b>{f ? dm(f.due) : "-"}</b> - {f ? STATUS[f.status] : "sem compras"}
        {f && f.paid > 0.005 && <span className="muted"> - pago {brl(f.paid)}</span>}
      </p>
      <div className="kpis compact">
        <div><span>Total da fatura</span><b>{brl(total)}</b><small className="muted">{futuro > 0 ? `inclui ${brl(futuro)} de parcelas previstas` : `${list.length} compras`}</small></div>
        {f && f.status !== "paga" && <div><span>Falta pagar</span><b className={f.status === "vencida" ? "warn" : ""}>{brl(f.rest)}</b></div>}
        {card.limit && <div><span>Limite usado</span><b>{fmt((st.open / card.limit) * 100, 0)}%</b><small className="muted">{brl(st.open, 0)} de {brl(card.limit, 0)}</small></div>}
      </div>
      {card.budget ? (
        <div className="limit budget" title={`${brl(total)} de ${brl(card.budget)} planejados`}>
          <span className={total > card.budget ? "limit-fill over" : total > card.budget * 0.8 ? "limit-fill high" : "limit-fill"} style={{ width: `${Math.min(100, (total / card.budget) * 100)}%` }} />
          <small className={total > card.budget ? "warn" : "muted"}>planejado {brl(card.budget, 0)} por fatura: {fmt((total / card.budget) * 100, 0)}% usado
            {total < card.budget ? ` - sobram ${brl(card.budget - total, 0)}` : ` - passou ${brl(total - card.budget, 0)}`}</small>
        </div>
      ) : <p className="muted small">Sem planejamento: em &quot;Cadastrar cartao&quot; (acima), informe quanto quer gastar por fatura para acompanhar aqui.</p>}

      {cats.length > 0 && (
        <figure className="viz">
          <figcaption className="small muted">Por categoria nesta fatura</figcaption>
          <div className="hbars">
            {cats.map(([c, v]) => (
              <div key={c} className="hbar" title={`${c}: ${brl(v)}`}>
                <span className="hbar-label small">{c}</span>
                <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(v / maxCat) * 100}%` }} /></span>
                <span className="hbar-value small">{fmt(v, 0)} <span className="muted">{total > 0 ? `${fmt((v / total) * 100, 0)}%` : ""}</span></span>
              </div>
            ))}
          </div>
        </figure>
      )}

      {list.length ? (
        <div className="table-scroll">
          <table className="stack gastos">
            <thead><tr><th>Compra</th><th>Categoria</th><th>Valor</th><th /></tr></thead>
            <tbody>
              {list.map(({ m, g }) => (
                <tr key={g.id}>
                  <td><span className="cell">{g.desc}<small className="muted">{[dm(g.d), g.parc ? `parcela ${g.parc[0]}/${g.parc[1]}` : null].filter(Boolean).join(" - ")}</small></span></td>
                  <td data-label="Categoria"><CatSelect value={g.cat} onChange={(c) => setCat(m, g.id, c)} /></td>
                  <td data-label="Valor" className={g.tipo === "receita" ? "pos" : ""}>{g.tipo === "receita" ? "+" : "-"}{brl(g.v)}</td>
                  <td className="actions"><button className="ghost small-btn" onClick={() => remove(m, g.id, g.desc)}>apagar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted small">Nenhuma compra lancada nesta fatura.</p>}

      {later.length > 0 && (
        <p className="small muted">Proximas faturas: {later.map((x) => `${monthLabel(x.m)} ${brl(x.rest, 0)}${x.futuro > 0 ? " (parcelas)" : ""}`).join(" - ")}</p>
      )}
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
      <h2>{which === "cards" ? "Faturas" : "Parcelas"} nos proximos 12 meses</h2>
      <figure className="viz">
        <figcaption className="small muted">{h ? `${monthLabel(h.m)}: ${what} ${brl(val(h))}` : "passe o mouse para ver o valor do mes"}</figcaption>
        <div className="mbars twelve" onMouseLeave={() => setHover(null)}>
          {data.map((x, i) => (
            <div key={x.m} className={`mbar${hover !== null && hover !== i ? " dim" : ""}`} onMouseEnter={() => setHover(i)} title={`${monthLabel(x.m)}: ${brl(val(x))}`}>
              <span className="stack-col"><span className={`mbar-fill ${which === "cards" ? "k-cards" : "k-loans"}`} style={{ height: `${(val(x) / max) * 100}%` }} /></span>
              <small>{monthLabel(x.m)}</small>
            </div>
          ))}
        </div>
      </figure>
      <p className="muted small">{which === "cards" ? "Faturas futuras somam as parcelas que ainda vem; compras novas aumentam esses valores." : "Parcelas adiantadas ja saem daqui. Para mudar quais meses o adiantamento cobre, use \"Adiantar parcelas\"."}</p>
    </section>
  );
}

// Entrada de dados desta sub-aba: compra no cartao, importar fatura, cartao e emprestimo (novo ou alterar)
function CardsEntryPanel({ months, setup, invest, entry, setEntry }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; entry: CardsEntry; setEntry: (e: CardsEntry) => void;
}) {
  const { type, id } = entry;
  const reset = () => setEntry({ type, id: null });
  const noCards = !setup.cards.length && type === "compra";
  const saveCards = async (c: Card) => { await saveSetup({ cards: setup.cards.some((x) => x.id === c.id) ? setup.cards.map((x) => (x.id === c.id ? c : x)) : [...setup.cards, c] }); reset(); };
  const saveLoans = async (l: Loan) => { await saveSetup({ loans: setup.loans.some((x) => x.id === l.id) ? setup.loans.map((x) => (x.id === l.id ? l : x)) : [...setup.loans, l] }); reset(); };
  const opts = type === "card" ? setup.cards.map((c) => ({ id: c.id, label: c.name })) : type === "loan" ? setup.loans.map((l) => ({ id: l.id, label: l.name })) : null;
  const noLoans = type === "prepay" && !setup.loans.length;
  return (
    <div className="entry">
      <p className="small entry-q">O que voce quer lancar?</p>
      <div className="kind-pick entry-types">
        {TYPES.filter((t) => LOAN_TYPES.includes(t.id) === LOAN_TYPES.includes(type)).map((t) => <button key={t.id} type="button" className={type === t.id ? "pill on" : "pill"} onClick={() => setEntry({ type: t.id, id: null })}>{t.label}</button>)}
      </div>
      {opts && (
        <label className="entry-pick small">Novo ou alterar:
          <select value={id ?? ""} onChange={(e) => setEntry({ type, id: e.target.value || null })}>
            <option value="">+ novo</option>
            {opts.map((o) => <option key={o.id} value={o.id}>alterar: {o.label}</option>)}
          </select>
        </label>
      )}
      {noCards && <p className="muted small">Cadastre um cartao primeiro (opcao &quot;Cadastrar cartao&quot;).</p>}
      {noLoans && <p className="muted small">Cadastre o emprestimo primeiro (opcao &quot;Cadastrar emprestimo&quot;).</p>}
      {type === "prepay" && !noLoans && <PrepayForm key={id ?? "p"} setup={setup} loanId={id ?? setup.loans[0].id} onPick={(lid) => setEntry({ type, id: lid })} />}
      {type === "compra" && !noCards && <QuickAdd key="compra" mode="cartao" months={months} setup={setup} invest={invest} defaultDate={todayBR()} />}
      {type === "card" && (
        <>
          <CardForm key={id ?? "novo"} c={setup.cards.find((c) => c.id === id) ?? { id: newId(), name: "", closeDay: 1, dueDay: 8 }} onSave={saveCards} onCancel={reset} />
          {id && <button className="ghost small-btn" onClick={async () => { if (confirm("Remover este cartao? (as compras continuam lancadas)")) { await saveSetup({ cards: setup.cards.filter((c) => c.id !== id) }); reset(); } }}>remover este cartao</button>}
        </>
      )}
      {type === "loan" && (
        <>
          <LoanForm key={id ?? "novo"} l={setup.loans.find((l) => l.id === id) ?? { id: newId(), name: "", parcela: 0, n: 12, first: monthOf(todayBR()), dueDay: 10, paidBefore: 0 }} onSave={saveLoans} onCancel={reset} />
          {id && <button className="ghost small-btn" onClick={async () => { if (confirm("Remover este emprestimo?")) { await saveSetup({ loans: setup.loans.filter((l) => l.id !== id) }); reset(); } }}>remover este emprestimo</button>}
        </>
      )}
    </div>
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
    if (qty > st.left) return alert(`So restam ${st.left} parcelas.`);
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
    if (!confirm("Desfazer este adiantamento?")) return;
    await saveSetup({ loans: setup.loans.map((l) => (l.id === loan.id ? { ...l, prepay: (l.prepay ?? []).filter((p) => p.id !== pid) } : l)) });
  };
  return (
    <form className="fin-form" onSubmit={save}>
      <div className="row wrapline">
        <label>Emprestimo
          <select value={loan.id} onChange={(e) => onPick(e.target.value)}>{setup.loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label>Quantas parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 80 }} /></label>
        <label>Quanto pagou (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder={fmt(qty * loan.parcela)} /></label>
        <label>Quais parcelas
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="fim">as ultimas (termina antes)</option>
            <option value="next">as proximas ({monthLabel(nextM)} em diante)</option>
            {monthsOpt.map((m) => <option key={m} value={m}>a partir de {monthLabel(m, true)}</option>)}
          </select>
        </label>
        <button className="primary" type="submit">Adiantar</button>
      </div>
      <p className="muted small">
        {qty} x {brl(loan.parcela)} = {brl(qty * loan.parcela)}{num(v) > 0 && num(v) < qty * loan.parcela ? ` - desconto de ${brl(qty * loan.parcela - num(v))}` : ""}.
        {from === "fim" ? <>As ultimas parcelas saem do contrato: termina em {monthLabel(addMonths(st.end, -qty), true)} (hoje: {monthLabel(st.end, true)}).</>
          : <>Esses meses ficam sem parcela; o fim do contrato nao muda.</>}
        O pagamento em si entra pelo extrato da conta (categoria Emprestimos).
      </p>
      {(loan.prepay ?? []).length > 0 && (
        <ul className="pend small">
          {loan.prepay!.map((p) => (
            <li key={p.id}><span className="muted">{dm(p.d)}</span> <b>{p.n} {p.n > 1 ? "parcelas adiantadas" : "parcela adiantada"}</b>
              <span>{brl(p.v)}</span>
              <span className="muted">cobre {range(covered(p.id))}</span>
              <select className="pay-sel" value={!p.from || p.from === "fim" ? "fim" : p.from} onChange={(e) => setPFrom(p.id, e.target.value)} aria-label="Quais parcelas">
                <option value="fim">as ultimas</option>
                {monthsOpt.map((m) => <option key={m} value={m}>a partir de {monthLabel(m, true)}</option>)}
              </select>
              <button className="link" type="button" onClick={() => undo(p.id)}>desfazer</button></li>
          ))}
        </ul>
      )}
    </form>
  );
}
