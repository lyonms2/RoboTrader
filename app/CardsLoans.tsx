"use client";
import { useState } from "react";
import {
  addMonths, cardStatus, commitments, debts, faturaItems, faturaMonth, monthLabel, monthOf, newId, tipoOfCat, todayBR,
  type Card, type GastosSetup, type Loan, type MonthDoc,
} from "@/lib/gastos";
import type { FinItem } from "@/lib/types";
import { CardForm, CatSelect, ImportPanel, LoanForm, Loans, QuickAdd, saveMonth, saveSetup } from "./GastosCard";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export type CardsEntry = { type: "compra" | "import" | "card" | "loan"; id: string | null };
const TYPES: { id: CardsEntry["type"]; label: string }[] = [
  { id: "compra", label: "Compra no cartao" }, { id: "import", label: "Importar fatura" }, { id: "card", label: "Cartao" }, { id: "loan", label: "Emprestimo" },
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

// Sub-aba Cartoes e emprestimos: todo o controle do credito (compras, faturas, planejamento, parcelas, emprestimos)
export default function CardsLoans({ months, setup, invest, entry, setEntry }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; entry: CardsEntry; setEntry: (e: CardsEntry) => void;
}) {
  const cards = setup.cards;
  const [sel, setSel] = useState(cards[0]?.id ?? "");
  const card = cards.find((c) => c.id === sel) ?? cards[0];
  const st = card ? cardStatus(card, months) : null;
  const [fmSel, setFm] = useState<string | null>(null);
  const fm = fmSel ?? (card ? faturaMonth(card, todayBR()) : monthOf(todayBR()));
  const d = debts(months, setup);
  const com = commitments(months, setup);
  const next = com[1];
  const planned = cards.reduce((s, c) => s + (c.budget ?? 0), 0);
  const usedNow = cards.reduce((s, c) => s + (cardStatus(c, months).all.find((f) => f.m === faturaMonth(c, todayBR()))?.v ?? 0), 0);

  return (
    <>
      <section className="card">
        <h2>Cartoes e emprestimos</h2>
        <div className="kpis">
          <div><span>Devendo nos cartoes</span><b className={d.cards > 0 ? "warn" : ""}>{brl(d.cards)}</b><small className="muted">faturas a pagar + parcelas futuras</small></div>
          <div><span>Devendo em emprestimos</span><b>{brl(d.loans)}</b><small className="muted">saldo devedor</small></div>
          <div><span>Compromisso em {monthLabel(next.m)}</span><b>{brl(next.cards + next.loans)}</b><small className="muted">faturas {brl(next.cards, 0)} + parcelas {brl(next.loans, 0)}</small></div>
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

      <CommitmentsChart data={com} />

      <Loans setup={setup} onEdit={(id) => { setEntry({ type: "loan", id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
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
      ) : <p className="muted small">Sem planejamento: em &quot;Cartao&quot; (acima), informe quanto quer gastar por fatura para acompanhar aqui.</p>}

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

// Compromissos dos proximos 12 meses: faturas + parcelas de emprestimo (barras empilhadas, 2 series)
function CommitmentsChart({ data }: { data: { m: string; cards: number; loans: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((x) => x.cards + x.loans), 0);
  if (!(max > 0)) return null;
  const h = hover !== null ? data[hover] : null;
  return (
    <section className="card">
      <h2>Compromissos dos proximos 12 meses</h2>
      <figure className="viz">
        <figcaption className="small muted">
          <i className="key k-cards" /> faturas (com parcelas) <i className="key k-loans" /> parcelas de emprestimo
          {h ? ` - ${monthLabel(h.m)}: faturas ${brl(h.cards, 0)} + emprestimos ${brl(h.loans, 0)} = ${brl(h.cards + h.loans, 0)}` : ""}
        </figcaption>
        <div className="mbars twelve" onMouseLeave={() => setHover(null)}>
          {data.map((x, i) => (
            <div key={x.m} className={`mbar${hover !== null && hover !== i ? " dim" : ""}`} onMouseEnter={() => setHover(i)}
              title={`${monthLabel(x.m)}: faturas ${brl(x.cards)} + emprestimos ${brl(x.loans)}`}>
              <span className="stack-col">
                <span className="mbar-fill k-loans" style={{ height: `${(x.loans / max) * 100}%` }} />
                <span className="mbar-fill k-cards" style={{ height: `${(x.cards / max) * 100}%` }} />
              </span>
              <small>{monthLabel(x.m)}</small>
            </div>
          ))}
        </div>
      </figure>
      <p className="muted small">Faturas futuras somam as parcelas que ainda vem; compras novas aumentam esses valores.</p>
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
  return (
    <div className="entry">
      <p className="small entry-q">O que voce quer lancar?</p>
      <div className="kind-pick entry-types">
        {TYPES.map((t) => <button key={t.id} type="button" className={type === t.id ? "pill on" : "pill"} onClick={() => setEntry({ type: t.id, id: null })}>{t.label}</button>)}
      </div>
      {opts && (
        <label className="entry-pick small">Novo ou alterar:
          <select value={id ?? ""} onChange={(e) => setEntry({ type, id: e.target.value || null })}>
            <option value="">+ novo</option>
            {opts.map((o) => <option key={o.id} value={o.id}>alterar: {o.label}</option>)}
          </select>
        </label>
      )}
      {noCards && <p className="muted small">Cadastre um cartao primeiro (opcao &quot;Cartao&quot;).</p>}
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
