"use client";
import { useState } from "react";
import {
  addMonths, cardStatus, commitments, debts, faturaItems, faturaMonth, loanStatus, prepaidSlots, monthLabel, monthOf, newId, tipoOfCat, todayBR,
  type Card, type GastosSetup, type Loan, type MonthDoc,
} from "@/lib/gastos";
import type { FinItem } from "@/lib/types";
import { CardForm, CatSelect, ImportPanel, LoanForm, Loans, QuickAdd, saveMonth, saveSetup } from "./GastosCard";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export type CardsEntry = { type: "compra" | "import" | "card" | "loan" | "prepay"; id: string | null };
const TYPES: { id: CardsEntry["type"]; label: string }[] = [
  { id: "compra", label: "Compra no cartao" }, { id: "import", label: "Importar fatura" }, { id: "card", label: "Cadastrar cartao" },
  { id: "loan", label: "Cadastrar emprestimo" }, { id: "prepay", label: "Adiantar parcelas" },
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
        : <LoansPart setup={setup} entry={entry} setEntry={setEntry} owed={d.loans} com={com} />}
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

function LoansPart({ setup, entry, setEntry, owed, com }: {
  setup: GastosSetup; entry: CardsEntry; setEntry: (e: CardsEntry) => void; owed: number; com: Com;
}) {
  const next = com[1];
  const sts = setup.loans.map((l) => ({ l, st: loanStatus(l) }));
  const active = sts.filter((x) => x.st.left > 0);
  const lastEnd = active.reduce((m, x) => (x.st.end > m ? x.st.end : m), "");
  const saved = sts.reduce((s, x) => s + x.st.saved, 0);
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
  return (
    <>
      <section className="card">
        <h2>Emprestimos</h2>
        <div className="kpis">
          <div><span>Devendo em emprestimos</span><b>{brl(owed)}</b><small className="muted">saldo devedor de {active.length} {active.length === 1 ? "emprestimo" : "emprestimos"}</small></div>
          <div><span>Parcelas em {monthLabel(next.m)}</span><b>{brl(next.loans)}</b><small className="muted">sai da conta todo mes</small></div>
          <div><span>Livre de emprestimos em</span><b>{lastEnd ? monthLabel(lastEnd, true) : "-"}</b><small className="muted">ultima parcela</small></div>
          {saved > 0.005 && <div><span>Economizou adiantando</span><b className="pos">{brl(saved)}</b></div>}
        </div>
        <p className="muted small">As parcelas saem pelo extrato da conta (categoria Emprestimos). Aqui fica o contrato: quanto falta, quando termina e os adiantamentos.</p>
      </section>

      <section className="card entry-card">
        <CardsEntryPanel months={{}} setup={setup} invest={[]} entry={entry} setEntry={setEntry} />
      </section>

      <Loans setup={setup} onEdit={(id) => { setEntry({ type: "loan", id }); top(); }} onPrepay={(id) => { setEntry({ type: "prepay", id }); top(); }} />

      <CommitmentsChart data={com} which="loans" />
    </>
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
  const noCards = !setup.cards.length && (type === "compra" || type === "import");
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
      {type === "import" && !noCards && <ImportPanel mode="cartao" months={months} setup={setup} invest={invest} onDone={() => setEntry({ type: "compra", id: null })} />}
      {type === "card" && (
        <>
          <CardForm key={id ?? "novo"} c={setup.cards.find((c) => c.id === id) ?? { id: newId(), name: "", closeDay: 1, dueDay: 8 }} onSave={saveCards} onCancel={reset} />
          {id && <button className="ghost small-btn" onClick={async () => { if (confirm("Remover este cartao? (as compras continuam lancadas)")) { await saveSetup({ cards: setup.cards.filter((c) => c.id !== id) }); reset(); } }}>remover este cartao</button>}
        </>
      )}
      {type === "loan" && (
        <>
          <LoanForm key={id ?? "novo"} l={setup.loans.find((l) => l.id === id) ?? { id: newId(), name: "", parcela: 0, n: 12, first: monthOf(todayBR()), dueDay: 10 }} onSave={saveLoans} onCancel={reset} />
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
