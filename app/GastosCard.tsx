"use client";
import { doc, setDoc } from "firebase/firestore";
import { useMemo, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { CARD_PAY_CAT, GENERIC_CATS, INVEST_CAT, TRANSFER_CAT, customCats, setCustomCats, accNameFromDesc, looksDuplicate, suggestCard, suggestToAcc, unmatchedTransfers, accIdOf, accountsOf, accountsStatus, cardStatus, debts, guessBank, invNameFromDesc, linkable, ofxBalance, prevDay, suggestInv, type Account } from "@/lib/gastos";
import type { FinItem } from "@/lib/types";
import { CardPayForm } from "./CardsLoans";
import {
  CATS_GASTO, CATS_NEUTRO, CATS_RECEITA, addMonths, avgMonthly, categorize, dayIn, decode, descKey, faturaMonth, loanStatus, monthLabel,
  dirOf, fixoActive, fixoExpected, fixoHistory, fixoReajPending, fixoValue, monthOf, newId, plain, parcOf, parseCSV, parseOFX, pendingFor, summarize, tipoOfCat, todayBR,
  type Card, type Fixo, type Gasto, type GastosSetup, type Loan, type MonthDoc, type Raw, type Tipo,
} from "@/lib/gastos";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
function num(s: string) {
  let t = s.replace(/[\sR$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t) || 0;
}
export const saveMonth = (m: string, items: Gasto[]) =>
  setDoc(doc(db(), "config", `gastos-${m}`), { items: clean([...items].sort((a, b) => a.d.localeCompare(b.d))) });
export const saveSetup = (s: Partial<GastosSetup>) => setDoc(doc(db(), "config", "gastos-setup"), clean(s), { merge: true });

// Grava lancamentos que podem cair em meses diferentes (parcelas, importacao)
async function addItems(months: Record<string, MonthDoc>, list: Gasto[]) {
  const by: Record<string, Gasto[]> = {};
  for (const g of list) (by[monthOf(g.d)] ??= []).push(g);
  await Promise.all(Object.entries(by).map(([m, add]) => saveMonth(m, [...(months[m]?.items ?? []), ...add])));
}

export { debts };

// Pagamento de fatura saindo da conta: e o gasto do mes (as compras no cartao nao entram no mes, entram pela fatura)
const isFaturaOut = (g: Gasto) =>
  g.cat === CARD_PAY_CAT && !g.card && dirOf(g) < 0;

// Resumo do mes atual (para a pagina Resumo das Financas)
export function monthSnapshot(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const m = monthOf(todayBR());
  const items = months[m]?.items ?? [];
  const s = summarize(items);
  const pending = pendingFor(m, items, setup, months);
  return { m, ...s, count: items.length, pending: pending.reduce((a, p) => a + p.v, 0), pendingN: pending.length, avg: avgMonthly(months) };
}

// Cartoes e dividas: resumo + cartoes + emprestimos
export function DebtsBlock({ months, setup, onEdit }: { months: Record<string, MonthDoc>; setup: GastosSetup; onEdit?: (type: "card" | "loan", id: string | null) => void }) {
  const cards = setup.cards.map((c) => ({ c, st: cardStatus(c, months) }));
  return (
    <div className="two-col">
      <Cards cards={cards} setup={setup} onEdit={onEdit && ((id) => onEdit("card", id))} />
      <Loans setup={setup} months={months} onEdit={onEdit && ((id) => onEdit("loan", id))} />
    </div>
  );
}

// Proximos pagamentos (Resumo): faturas, fixos e parcelas nos proximos 30 dias, mais o que ja venceu sem pagamento
export function upcoming(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const today = todayBR();
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const out: { d: string; desc: string; v: number; late: boolean; loan?: boolean; card?: boolean }[] = [];
  for (const c of setup.cards) {
    const st = cardStatus(c, months);
    for (const f of st.overdue) out.push({ d: f.due, desc: `Fatura ${c.name} (${monthLabel(f.m)})`, v: f.rest, late: true, card: true });
    if (st.next && st.next.due <= limit) out.push({ d: st.next.due, desc: `Fatura ${c.name} (${st.next.status === "fechada" ? "fechada" : "ainda aberta"})`, v: st.next.v, late: false });
  }
  const m = monthOf(today);
  for (const mm of [m, addMonths(m, 1)])
    for (const p of pendingFor(mm, months[mm]?.items ?? [], setup, months))
      if (p.d <= limit && !p.card) out.push({ d: p.d, desc: p.desc, v: p.v, late: p.d < today, loan: !!p.parc });
  // parcelas de emprestimo de meses anteriores que continuam sem pagamento
  for (const l of setup.loans)
    for (const r of loanStatus(l, today, { months, setup }).rows)
      if (r.status === "atrasada" && r.m < m) out.push({ d: r.due, desc: `${l.name} (parcela ${r.k + 1}/${l.n})`, v: l.parcela, late: true, loan: true });
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

export default function GastosCard({ months, setup, invest = [], onBens, entry }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest?: FinItem[]; onBens?: () => void; entry?: React.ReactNode;
}) {
  const [m, setM] = useState(monthOf(todayBR()));
  const [filter, setFilter] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [where, setWhere] = useState(""); // "" = tudo; "acc:id" ou "card:id"
  const items = months[m]?.items ?? [];
  const s = summarize(items);
  const avg = avgMonthly(months);
  const pending = pendingFor(m, items, setup, months);
  const pendingTotal = pending.reduce((a, p) => a + p.v, 0);
  const prevAvg = useMemo(() => {
    // media por categoria nos 3 meses anteriores ao mes aberto
    const keys = [1, 2, 3].map((k) => addMonths(m, -k)).filter((k) => months[k]?.items.length);
    const acc: Record<string, number> = {};
    for (const k of keys) for (const [c, v] of Object.entries(summarize(months[k].items).byCat)) acc[c] = (acc[c] ?? 0) + v / keys.length;
    return { acc, n: keys.length };
  }, [m, months]);

  const learnAndSet = async (g: Gasto, cat: string) => {
    const tipo = tipoOfCat(cat) ?? g.tipo;
    const key = descKey(g.desc);
    // Virou Investimento: ja sugere o destino; deixou de ser: desliga
    const inv = cat === INVEST_CAT ? (g.inv ?? suggestInv(g.desc, invest, setup.invRules)) : undefined;
    const payCard = cat === CARD_PAY_CAT && !g.card ? (g.payCard ?? suggestCard(g.desc, g.v, setup.cards, months)) : undefined;
    const toAcc = cat === TRANSFER_CAT && !g.card ? (g.toAcc ?? suggestToAcc(g.desc, accIdOf(g, accountsOf(setup)), setup)) : undefined;
    // Aplica a todos os lancamentos do mes com a mesma descricao e lembra para os proximos
    // guarda a direcao (entrou/saiu) antes de trocar o tipo: neutro sem direcao seria adivinhado pelo texto
    await saveMonth(m, items.map((x) => (x.id === g.id || (key && descKey(x.desc) === key) ? clean({ ...x, cat, tipo, inv, payCard, toAcc, io: x.io ?? (dirOf(x) > 0 ? "in" : "out") }) : x)));
    if (key && !GENERIC_CATS.includes(cat)) await saveSetup({ rules: { ...setup.rules, [key]: cat } });
  };
  // Liga a transferencia (e as iguais do mes) a outra conta sua; "__new" cria uma conta sem extrato
  const linkAcc = async (g: Gasto, id: string) => {
    const target = id === "__new" ? await createEnvelope(setup, g.desc) : id || undefined;
    const key = descKey(g.desc);
    await saveMonth(m, items.map((x) => (x.id === g.id || (key && x.cat === TRANSFER_CAT && descKey(x.desc) === key) ? clean({ ...x, toAcc: target }) : x)));
    if (key && target) await saveSetup({ accRules: { ...(setup.accRules ?? {}), [key]: target } });
  };
  // Liga o lancamento (e os iguais do mes) a um investimento; "__new" cria um cofrinho com o nome do extrato
  const linkInv = async (g: Gasto, id: string) => {
    const target = id === "__new" ? await createBox(invest, g.desc, g.d) : id || undefined;
    const key = descKey(g.desc);
    await saveMonth(m, items.map((x) => (x.id === g.id || (key && x.cat === INVEST_CAT && descKey(x.desc) === key) ? { ...x, inv: target } : x)));
    if (key && target) await saveSetup({ invRules: { ...(setup.invRules ?? {}), [key]: target } });
  };
  const removeItem = async (g: Gasto) => {
    if (!confirm(`Apagar "${g.desc}" (${brl(g.v)})?`)) return;
    await saveMonth(m, items.filter((x) => x.id !== g.id));
  };
  // Pagou o fixo/parcela por fora do extrato: escolhe com qual conta (ou cartao) foi pago; o saldo dela baixa
  const launch = async (p: (typeof pending)[number], src: string) => {
    // ja veio no extrato: liga o lancamento ao fixo (e aprende a descricao para os proximos meses)
    if (src.startsWith("item:")) {
      const g = items.find((x) => x.id === src.slice(5));
      if (!g) return;
      await saveMonth(m, items.map((x) => (x.id === g.id ? { ...x, ref: p.ref } : x)));
      const f = setup.fixos.find((x) => x.id === p.ref);
      const key = descKey(g.desc);
      if (f && key && !(f.keys ?? []).includes(key)) await saveSetup({ fixos: setup.fixos.map((x) => (x.id === f.id ? { ...x, keys: [...(x.keys ?? []), key] } : x)) });
      return;
    }
    let v = p.v;
    if (p.varia) {
      const ans = prompt(`Quanto veio ${p.desc} este mes? (R$)`, fmt(p.v));
      if (ans === null) return;
      v = num(ans);
      if (!(v > 0)) return;
    }
    const where = src.startsWith("card:") ? { card: src.slice(5) } : src.startsWith("acc:") ? { acc: src.slice(4) } : p.card ? { card: p.card } : {};
    await saveMonth(m, [...items, { id: newId(), d: p.d, desc: p.desc, v, tipo: "gasto", io: "out", cat: p.cat, src: p.parc ? "emprestimo" : "fixo", ref: p.ref, ...where, ...(p.parc ? { parc: p.parc } : {}) }]);
  };

  const accs = accountsOf(setup);
  // Lancamentos = extrato da conta: compras no cartao ficam em Cartoes e emprestimos
  const shown = [...items].filter((g) => !g.card).filter((g) => !filter || g.cat === filter)
    .filter((g) => !where || accIdOf(g, accs) === where.slice(4))
    .sort((a, b) => b.d.localeCompare(a.d));
  const acSt = accountsStatus(months, setup, m);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...cats.map(([c, v]) => Math.max(v, prevAvg.acc[c] ?? 0)), 0);
  const isNow = m === monthOf(todayBR());

  return (
    <>
      {entry && <section className="card entry-card">{entry}</section>}
      <section className="card">
        <div className="card-head">
          <div className="month-nav">
            <button className="ghost icon" aria-label="Mes anterior" onClick={() => setM(addMonths(m, -1))}>&lsaquo;</button>
            <h2>{monthLabel(m, true)}</h2>
            <button className="ghost icon" aria-label="Proximo mes" onClick={() => setM(addMonths(m, 1))}>&rsaquo;</button>
            {!isNow && <button className="ghost small-btn" onClick={() => setM(monthOf(todayBR()))}>hoje</button>}
          </div>
          <span className="muted small">{items.filter((g) => !g.card).length} lancamentos na conta</span>
        </div>
        <div className="kpis">
          <div><span>Saidas (gastos)</span><b>{brl(s.gastos)}</b>
            <small className={avg && s.gastos > avg.value * 1.1 ? "warn" : "muted"}>{avg ? `media ${brl(avg.value, 0)} (${avg.months} ${avg.months > 1 ? "meses" : "mes"})` : "a media aparece no 2o mes"}</small></div>
          <div><span>Entradas</span><b>{brl(s.receitas)}</b><small className="muted">salario, Pix recebidos...</small></div>
          <div><span>Sobrou</span><b className={s.receitas - s.gastos >= 0 ? "pos" : "neg"}>{brl(s.receitas - s.gastos)}</b>
            <small className="muted">{s.receitas > 0 ? `${fmt(((s.receitas - s.gastos) / s.receitas) * 100, 0)}% das entradas` : "entradas - gastos"}</small></div>
          <div><span>Ainda a pagar</span><b className={pendingTotal > 0 ? "warn" : ""}>{brl(pendingTotal)}</b>
            <small className="muted">{pending.length ? `${pending.length} fixos/parcelas - previsto ${brl(s.gastos + pendingTotal, 0)}` : "fixos e parcelas em dia"}</small></div>
        </div>
        {acSt.rows.some((r) => r.used || r.informed) && (
          <p className="small acct-line">
            Contas: inicio do mes <b>{brl(acSt.start)}</b> &rarr; {isNow ? "hoje" : "fim do mes"} <b className={acSt.end < 0 ? "neg" : ""}>{brl(acSt.end)}</b>
            {!acSt.allInformed && <span className="warn"> (falta conferir o saldo de alguma conta)</span>}
            {onBens && <button className="link" onClick={onBens}>ver contas</button>}
          </p>
        )}
        {(() => {
          // dinheiro que so mudou de lugar (cofrinho, cripto, entre contas): entra/sai da conta, mas nao e renda nem gasto
          const moves = items.filter((g) => !g.card && g.tipo === "neutro" && !isFaturaOut(g));
          if (!moves.length) return null;
          const byCat: Record<string, { in: number; out: number }> = {};
          for (const g of moves) { const b = (byCat[g.cat] ??= { in: 0, out: 0 }); if (dirOf(g) > 0) b.in += g.v; else b.out += g.v; }
          const mIn = moves.filter((g) => dirOf(g) > 0).reduce((t, g) => t + g.v, 0);
          const mOut = moves.filter((g) => dirOf(g) < 0).reduce((t, g) => t + g.v, 0);
          return (
            <p className="small acct-line">
              Na conta: entrou <b className="pos">{brl(s.receitas + mIn)}</b> <span className="muted">(renda {brl(s.receitas, 0)}{mIn ? ` + ${brl(mIn, 0)} de dinheiro seu voltando` : ""})</span>
              {" "}- saiu <b>{brl(s.gastos + mOut)}</b> <span className="muted">(gastos {brl(s.gastos, 0)}{mOut ? ` + ${brl(mOut, 0)} guardado/movido` : ""})</span>
              <br /><span className="muted">{Object.entries(byCat).map(([c, b]) => `${c}: ${[b.out ? `saiu ${brl(b.out, 0)}` : "", b.in ? `entrou ${brl(b.in, 0)}` : ""].filter(Boolean).join(", ")}`).join(" | ")}</span>
            </p>
          );
        })()}
        <Review months={months} setup={setup} invest={invest} />
        {pending.length > 0 && (
          <>
            <p className="small muted pend-title">Previstos para este mes (somem sozinhos quando o pagamento aparece num extrato importado):</p>
            <ul className="pend small">
              {pending.map((p) => (
                <li key={p.ref}>
                  <span className="muted">{dm(p.d)}</span> <b>{p.desc}</b> <span>{p.varia ? "~" : ""}{brl(p.v)}</span>
                  {p.varia && <span className="tag">varia</span>}
                  {p.reaj && <span className="tag warn">reajuste: confira o valor</span>}
                  <select className="pay-sel" value="" onChange={(e) => e.target.value && launch(p, e.target.value)}
                    title="Ligue ao lancamento do extrato, ou diga com o que pagou se nao vai aparecer em nenhum extrato">
                    <option value="">paguei com...</option>
                    {!p.parc && <optgroup label="ja veio no extrato">
                      {items.filter((g) => g.tipo === "gasto" && !g.ref && !g.card)
                        .sort((a, b) => Number(b.cat === p.cat) - Number(a.cat === p.cat) || Math.abs(a.v - p.v) - Math.abs(b.v - p.v)).slice(0, 8)
                        .map((g) => <option key={g.id} value={`item:${g.id}`}>{dm(g.d)} {g.desc.slice(0, 28)} {brl(g.v)}</option>)}
                    </optgroup>}
                    {accs.map((a) => <option key={a.id} value={`acc:${a.id}`}>{a.name}{a.noStatement ? " (sem extrato)" : ""}</option>)}
                    {setup.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>cartao {c.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}
        {cats.length > 0 && (
          <figure className="viz">
            <figcaption className="small muted">Gastos por categoria {prevAvg.n ? <>- <i className="tick-key" /> media dos {prevAvg.n} meses anteriores</> : ""} (clique para filtrar)</figcaption>
            <div className="hbars">
              {cats.map(([c, v]) => {
                const a = prevAvg.acc[c];
                return (
                  <div key={c} className={`hbar click${filter && filter !== c ? " dim" : ""}`} onClick={() => setFilter(filter === c ? null : c)}
                    title={`${c}: ${brl(v)}${a ? ` (media ${brl(a)})` : ""}`}>
                    <span className="hbar-label small">{c}</span>
                    <span className="hbar-track">
                      <span className="hbar-fill" style={{ width: `${(v / maxCat) * 100}%` }} />
                      {a ? <span className="hbar-tick" style={{ left: `${(a / maxCat) * 100}%` }} /> : null}
                    </span>
                    <span className="hbar-value small">{fmt(v, 0)} <span className={a && v > a * 1.2 ? "warn" : "muted"}>{s.gastos > 0 ? `${fmt((v / s.gastos) * 100, 0)}%` : ""}</span></span>
                  </div>
                );
              })}
            </div>
          </figure>
        )}
        <MonthsChart months={months} current={m} onPick={setM} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Lancamentos {filter && <span className="tag">{filter} <button className="link" onClick={() => setFilter(null)}>x</button></span>}</h2>
          <div className="row">
            {accs.length > 1 && (
              <select value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Filtrar por conta" className="where-sel">
                <option value="">Todas as contas</option>
                {accs.map((a) => <option key={a.id} value={`acc:${a.id}`}>Conta {a.name}</option>)}
              </select>
            )}
            {!entry && <button className="ghost" onClick={() => setImporting(!importing)}>{importing ? "Fechar importacao" : "Importar extrato"}</button>}
          </div>
        </div>
        {!entry && (importing ? <ImportPanel months={months} setup={setup} invest={invest} onDone={() => setImporting(false)} />
          : <QuickAdd months={months} setup={setup} invest={invest} defaultDate={isNow ? todayBR() : `${m}-01`} />)}
        {shown.length ? (
          <div className="table-scroll">
            <table className="stack gastos">
              <thead><tr><th>Descricao</th><th>Categoria</th><th>Valor</th><th /></tr></thead>
              <tbody>
                {shown.map((g) => {
                  const card = setup.cards.find((c) => c.id === g.card);
                  const accs = accountsOf(setup);
                  const accName = !card && accs.length > 1 ? accs.find((a) => a.id === accIdOf(g, accs))?.name : null;
                  return (
                    <tr key={g.id} className={g.tipo === "neutro" && !isFaturaOut(g) ? "neutral" : ""}>
                      <td><span className="cell">{g.desc}<small className="muted">
                        {[dm(g.d), card ? `cartao ${card.name}` : accName, g.parc ? `parcela ${g.parc[0]}/${g.parc[1]}` : null, isFaturaOut(g) ? "conta nos gastos do mes (fatura paga)" : g.tipo === "neutro" ? (dirOf(g) > 0 ? "entrou na conta - nao e renda (dinheiro seu voltando)" : "saiu da conta - nao e gasto") : null].filter(Boolean).join(" - ")}
                      </small></span></td>
                      <td data-label="Categoria"><span className="cell">
                        <CatSelect value={g.cat} onChange={(c) => learnAndSet(g, c)} />
                        {g.cat === INVEST_CAT && <InvSelect value={g.inv} desc={g.desc} invest={invest} out={dirOf(g) < 0} onChange={(id) => linkInv(g, id)} />}
                        {g.cat === TRANSFER_CAT && !g.card && (
                          <ToAccSelect value={g.toAcc} from={accIdOf(g, accountsOf(setup))} out={dirOf(g) < 0} setup={setup} onChange={(id) => linkAcc(g, id)} />
                        )}
                        {g.cat === CARD_PAY_CAT && !g.card && setup.cards.length > 0 && (
                          <CardPaySelect value={g.payCard} cards={setup.cards} onChange={(id) => saveMonth(m, items.map((x) => (x.id === g.id ? clean({ ...x, payCard: id || undefined }) : x)))} />
                        )}
                      </span></td>
                      <td data-label="Valor" className={g.tipo === "receita" ? "pos" : g.tipo === "neutro" && !isFaturaOut(g) ? "muted" : ""}>{g.tipo === "receita" || (g.tipo === "neutro" && dirOf(g) > 0) ? "+" : "-"}{brl(g.v)}</td>
                      <td className="actions"><button className="ghost small-btn" onClick={() => removeItem(g)} aria-label="Apagar">apagar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Nenhum lancamento {filter ? "nesta categoria" : "neste mes"}.</p>}
        <p className="muted small">Mudou a categoria de um lancamento? O site aplica aos iguais do mes e lembra para as proximas importacoes.</p>
        <HowItWorks />
      </section>
    </>
  );
}

// Escolha da categoria. "Outros"/"Outras entradas" so aparecem quando o lancamento ainda esta nelas (importacao sem categoria);
// para algo novo, "+ nova categoria" cria uma sua
export function CatSelect({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const mine = customCats();
  const create = async (tipo: "gasto" | "receita", suggestion = "") => {
    const raw = window.prompt(tipo === "gasto" ? "O que e esse gasto? (vira uma categoria sua, ex.: Presentes, Pet, Academia)"
      : "O que e essa entrada? (vira uma categoria sua, ex.: Freela, Venda, Reembolso)", suggestion);
    const name = raw?.trim().replace(/^./, (c) => c.toUpperCase());
    if (!name) return null;
    // ja existe (com qualquer maiuscula/minuscula)? usa a existente
    const all = [...CATS_GASTO, ...CATS_RECEITA, ...CATS_NEUTRO, ...mine.map((x) => x.name)];
    const found = all.find((c) => c.toLowerCase() === name.toLowerCase());
    if (found) return found;
    const list = [...mine, { name, tipo }];
    setCustomCats(list);
    // grava em segundo plano: a escolha vale na hora
    saveSetup({ customCats: list }).catch((e) => console.error("categoria nao gravada", e));
    return name;
  };
  const pick = async (v: string) => {
    if (v === "__new_g" || v === "__new_r") {
      const n = await create(v === "__new_g" ? "gasto" : "receita");
      if (n) onChange(n);
      return;
    }
    onChange(v);
  };
  const g = mine.filter((c) => c.tipo === "gasto").map((c) => c.name);
  const r = mine.filter((c) => c.tipo === "receita").map((c) => c.name);
  return (
    <select value={value} onChange={(e) => pick(e.target.value)} className={`cat-sel${GENERIC_CATS.includes(value) ? " unlinked" : ""}`}>
      {GENERIC_CATS.includes(value) && <option value={value} disabled>{value}: escolha a categoria</option>}
      <optgroup label="Gastos">{[...CATS_GASTO.filter((c) => c !== "Outros"), ...g].map((c) => <option key={c}>{c}</option>)}
        <option value={CARD_PAY_CAT}>Fatura do cartao (pagamento)</option>
        <option value="__new_g">+ nova categoria de gasto</option></optgroup>
      <optgroup label="Entradas">{[...CATS_RECEITA.filter((c) => c !== "Outras entradas"), ...r].map((c) => <option key={c}>{c}</option>)}
        <option value="__new_r">+ nova categoria de entrada</option></optgroup>
      <optgroup label="Nem gasto nem renda (seu dinheiro mudando de lugar)">{CATS_NEUTRO.filter((c) => c !== CARD_PAY_CAT).map((c) => <option key={c}>{c}</option>)}</optgroup>
      {!tipoOfCat(value) && !GENERIC_CATS.includes(value) && <option>{value}</option>}
    </select>
  );
}

// Cria um cofrinho (saldo 0 no dia anterior ao movimento) na aba Investimentos; os movimentos ligados formam o saldo
async function createBox(invest: FinItem[], desc: string, d: string) {
  const name = window.prompt("Nome do cofrinho/investimento novo:", invNameFromDesc(desc));
  if (!name?.trim()) return undefined;
  const it: FinItem = { id: newId(), kind: "caixa", name: name.trim(), balance: 0, balanceAt: Date.parse(`${prevDay(d)}T12:00:00-03:00`), cdiPct: 100, reserva: true };
  await setDoc(doc(db(), "config/main"), { finance: clean([...invest, it]) }, { merge: true });
  return it.id;
}

// Cria uma conta sem extrato (ex.: conta da esposa) a partir do texto do lancamento
async function createEnvelope(setup: GastosSetup, desc: string) {
  const name = window.prompt("Nome da conta (sem extrato: comeca do zero, recebe as transferencias e voce lanca nela o que foi pago):", accNameFromDesc(desc));
  if (!name?.trim()) return undefined;
  const id = newId();
  await saveSetup({ accounts: clean([...accountsOf(setup), { id, name: name.trim(), noStatement: true }]), account: null } as Partial<GastosSetup>);
  return id;
}

// Para qual conta sua foi (ou de qual veio) a transferencia
function ToAccSelect({ value, from, out, setup, onChange }: { value?: string; from: string | null; out: boolean; setup: GastosSetup; onChange: (id: string) => void }) {
  const list = accountsOf(setup).filter((a) => a.id !== from);
  return (
    <select className={`cat-sel inv-sel${value ? "" : " unlinked"}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} title={out ? "Para qual conta foi" : "De qual conta veio"}>
      <option value="">{out ? "foi para qual conta? (escolher)" : "veio de qual conta? (escolher)"}</option>
      {list.map((a) => <option key={a.id} value={a.id}>{out ? "-> " : "<- "}{a.name}{a.noStatement ? " (sem extrato)" : ""}</option>)}
      <option value="__new">+ nova conta sem extrato</option>
    </select>
  );
}

// Qual cartao este pagamento de fatura pagou
function CardPaySelect({ value, cards, onChange }: { value?: string; cards: Card[]; onChange: (id: string) => void }) {
  return (
    <select className={`cat-sel inv-sel${value ? "" : " unlinked"}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} title="Qual cartao foi pago">
      <option value="">pagou qual cartao? (escolher)</option>
      {cards.map((c) => <option key={c.id} value={c.id}>pagou {c.name}</option>)}
    </select>
  );
}

// Para qual investimento foi (ou de qual veio) o dinheiro
function InvSelect({ value, desc, invest, out, onChange }: { value?: string; desc: string; invest: FinItem[]; out: boolean; onChange: (id: string) => void }) {
  const list = linkable(invest);
  return (
    <select className={`cat-sel inv-sel${value ? "" : " unlinked"}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
      title={out ? "Para onde foi o dinheiro" : "De onde veio o dinheiro"}>
      <option value="">{out ? "foi para... (escolher)" : "veio de... (escolher)"}</option>
      {list.map((i) => <option key={i.id} value={i.id}>{out ? "-> " : "<- "}{i.name}</option>)}
      <option value="__new">+ novo cofrinho: {invNameFromDesc(desc)}</option>
    </select>
  );
}

// Quantos pontos ha para revisar (para o "O que fazer hoje" da Visao geral)
export function reviewCount(months: Record<string, MonthDoc>, setup: GastosSetup) {
  let n = 0;
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (g.cat === INVEST_CAT && !g.inv) n++;
      if (g.cat === CARD_PAY_CAT && !g.card && !g.payCard && setup.cards.length) n++;
    }
  n += unmatchedTransfers(months, setup).filter((g) => dirOf(g) < 0).length;
  n += accountsStatus(months, setup).rows.filter((r) => r.used && !r.informed).length;
  if (genericCount(months)) n++;
  return n;
}

// Lancamentos em "Outros"/"Outras entradas" (sem dizer o que e)
export function genericCount(months: Record<string, MonthDoc>) {
  return Object.values(months).reduce((s, md) => s + md.items.filter((g) => GENERIC_CATS.includes(g.cat)).length, 0);
}

// Para revisar: tudo que deixaria um numero errado, com o conserto de 1 clique quando da
export function Review({ months, setup, invest }: { months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[] }) {
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<string | null>(null); // fatura vencida com o formulario de pagamento aberto
  const accounts = accountsOf(setup);
  // marcacoes do "ja paguei" antigo: ficavam dentro do cartao sem direcao e eram lidas como compra (somavam na fatura)
  const oldMarks: { m: string; g: Gasto }[] = [];
  for (const [m, md] of Object.entries(months))
    for (const g of md.items) if (g.card && g.cat === CARD_PAY_CAT && !g.io && g.src === "manual" && g.desc.includes("(marcado como pago)")) oldMarks.push({ m, g });
  // 1) investimento sem destino  2) pagamento de fatura sem cartao
  const fixes: { m: string; id: string; patch: Partial<Gasto> }[] = [];
  let invMissing = 0;
  let payMissing = 0;
  let recat = 0;
  for (const [m, md] of Object.entries(months))
    for (const g of md.items) {
      // em Outros/Outras entradas mas o texto diz o que e (ex.: "Dinheiro resgatado do cofrinho" = Investimento)
      if (GENERIC_CATS.includes(g.cat) && !g.card) {
        const io = g.io ?? (dirOf(g) > 0 ? "in" : "out");
        const c = categorize(g.desc, io === "in", {}, setup.ownName);
        if (!GENERIC_CATS.includes(c.cat)) {
          recat++;
          const inv = c.cat === INVEST_CAT ? suggestInv(g.desc, invest, setup.invRules) : undefined;
          fixes.push({ m, id: g.id, patch: { cat: c.cat, tipo: c.tipo, io, ...(inv ? { inv } : {}) } });
        }
      }
      if (g.cat === INVEST_CAT && !g.inv) {
        invMissing++;
        const inv = suggestInv(g.desc, invest, setup.invRules);
        if (inv) fixes.push({ m, id: g.id, patch: { inv } });
      }
      if (g.cat === CARD_PAY_CAT && !g.card && !g.payCard && setup.cards.length) {
        payMissing++;
        const pc = suggestCard(g.desc, g.v, setup.cards, months);
        if (pc) fixes.push({ m, id: g.id, patch: { payCard: pc } });
      }
      // transferencia sem conta de destino, mas com sugestao (escolha anterior ou nome da conta no texto)
      if (g.cat === TRANSFER_CAT && !g.card && !g.toAcc) {
        const to = suggestToAcc(g.desc, accIdOf(g, accounts), setup);
        if (to) fixes.push({ m, id: g.id, patch: { toAcc: to } });
      }
    }
  // 3) Pix para conta sua que nao esta no site  4) fatura vencida sem pagamento  5) conta sem saldo conferido
  const lost = unmatchedTransfers(months, setup).filter((g) => dirOf(g) < 0);
  const overdue = setup.cards.flatMap((c) => cardStatus(c, months).overdue.map((f) => ({ c, f })));
  const st = accountsStatus(months, setup);
  const noBalance = st.rows.filter((r) => r.used && !r.informed);
  const generic = genericCount(months);
  if (!invMissing && !payMissing && !lost.length && !overdue.length && !noBalance.length && !generic && !oldMarks.length) return null;
  const removeOldMarks = async () => {
    if (!confirm(`Apagar ${oldMarks.length} ${oldMarks.length > 1 ? "marcacoes" : "marcacao"} do "ja paguei" antigo? Depois marque o pagamento de novo pelo botao novo.`)) return;
    const by: Record<string, Set<string>> = {};
    for (const { m, g } of oldMarks) (by[m] ??= new Set()).add(g.id);
    await Promise.all(Object.entries(by).map(([m, ids]) => saveMonth(m, months[m].items.filter((x) => !ids.has(x.id)))));
  };
  const applyFixes = async () => {
    setBusy(true);
    const by: Record<string, Record<string, Partial<Gasto>>> = {};
    for (const f of fixes) (by[f.m] ??= {})[f.id] = { ...(by[f.m]?.[f.id] ?? {}), ...f.patch };
    await Promise.all(Object.entries(by).map(([m, ids]) => saveMonth(m, months[m].items.map((x) => (ids[x.id] ? { ...x, ...ids[x.id] } : x)))));
    setBusy(false);
  };
  return (
    <div className="review small">
      <b>Para revisar</b>
      <ul>
        {invMissing > 0 && <li>{invMissing} {invMissing > 1 ? "movimentos" : "movimento"} de investimento sem destino: o dinheiro sai da conta e nao entra em nenhum investimento.</li>}
        {payMissing > 0 && <li>{payMissing} {payMissing > 1 ? "pagamentos" : "pagamento"} de fatura sem cartao: a fatura continua aparecendo como divida.</li>}
        {recat > 0 && <li>{recat} {recat > 1 ? "lancamentos" : "lancamento"} em Outros/Outras entradas que o texto ja diz o que e (ex.: resgate de cofrinho = Investimento).</li>}
        {fixes.length > 0 && <li><button className="primary small-btn" disabled={busy} onClick={applyFixes}>{busy ? "Arrumando..." : `Arrumar ${fixes.length} automaticamente`}</button>
          {fixes.length < invMissing + payMissing + recat && <span className="muted"> os outros: escolha na lista de lancamentos</span>}</li>}
        {oldMarks.length > 0 && (
          <li className="warn">{oldMarks.length} {oldMarks.length > 1 ? "marcacoes" : "marcacao"} do &quot;ja paguei&quot; antigo ({brl(oldMarks.reduce((t, x) => t + x.g.v, 0))}) {oldMarks.length > 1 ? "estao" : "esta"}
            somando como compra na fatura seguinte, em vez de pagar. <button className="ghost small-btn" onClick={removeOldMarks}>apagar e marcar de novo</button></li>
        )}
        {lost.map((g) => (
          <li key={g.id}>{dm(g.d)}: {brl(g.v)} transferido sem conta de destino ({g.desc.slice(0, 40)}). Nos lancamentos, escolha &quot;foi para qual conta&quot;
            (ou &quot;+ nova conta sem extrato&quot;, para dinheiro que voce passa para alguem pagar por voce), ou troque a categoria se foi um gasto.</li>
        ))}
        {overdue.map(({ c, f }) => (
          <li key={c.id + f.m}>Fatura {c.name} de {monthLabel(f.m)} venceu em {dm(f.due)} com {brl(f.rest)} sem pagamento lancado.
            <button className="ghost small-btn" onClick={() => setPaying(paying === c.id + f.m ? null : c.id + f.m)}>{paying === c.id + f.m ? "fechar" : "ja paguei"}</button>
            {paying === c.id + f.m && <CardPayForm card={c} fm={f.m} rest={f.rest} due={f.due} months={months} setup={setup} onDone={() => setPaying(null)} />}</li>
        ))}
        {generic - recat > 0 && <li>{generic - recat} {generic - recat > 1 ? "lancamentos" : "lancamento"} em &quot;Outros&quot; sem dizer o que e: na lista, troque a categoria
          (escolha uma existente, ou &quot;+ nova categoria&quot; para criar a sua). Os iguais do mes mudam juntos e o site lembra para as proximas.</li>}
        {noBalance.map((r) => <li key={r.acc.id}>Conta {r.acc.name} sem saldo conferido: informe o saldo do app do banco em &quot;Contas&quot; para o patrimonio ficar certo.</li>)}
      </ul>
    </div>
  );
}

// Como cada tipo de movimento entra nas contas
function HowItWorks() {
  return (
    <details className="how small">
      <summary>Como o site conta cada coisa (cartao, emprestimo, cripto, cofrinho, fixos)</summary>
      <table>
        <thead><tr><th>Situacao</th><th>Gasto do mes</th><th>Saldo da conta</th><th>Patrimonio</th></tr></thead>
        <tbody>
          <tr><td><b>Compra no cartao</b></td><td>nao entra no mes da compra (fica na fatura, em Cartoes e emprestimos)</td><td>nao mexe</td><td>vira divida da fatura</td></tr>
          <tr><td><b>Pagar a fatura</b> (no extrato: &quot;Pagamento de fatura&quot;)</td><td>conta como gasto no mes em que voce paga (e o total das compras)</td><td>sai da conta</td><td>a divida baixa; nao muda</td></tr>
          <tr><td><b>Parcela de emprestimo</b></td><td>conta como gasto</td><td>sai da conta</td><td>o saldo devedor baixa sozinho pela data</td></tr>
          <tr><td><b>Dinheiro do emprestimo caindo</b></td><td>nao e renda (&quot;Emprestimo recebido&quot;)</td><td>entra na conta</td><td>nao muda (cadastre a divida)</td></tr>
          <tr><td><b>Guardar no cofrinho / resgatar</b></td><td>nao conta</td><td>sai / entra</td><td>nao muda (vai para o cofrinho)</td></tr>
          <tr><td><b>Comprar cripto</b> (Pix para corretora/ramp)</td><td>nao conta (&quot;Compra de cripto&quot;)</td><td>sai da conta</td><td>nao muda (aparece na carteira)</td></tr>
          <tr><td><b>Pix entre suas contas</b></td><td>nao conta</td><td>sai de uma, entra na outra</td><td>nao muda (escolha a conta de destino)</td></tr>
          <tr><td><b>Dinheiro que voce passa para alguem pagar por voce</b> (conta sem extrato)</td><td>so quando voce lanca o que foi pago (&quot;Pago com&quot; essa conta)</td><td>sai da sua, fica &quot;a discriminar&quot; na outra</td><td>nao muda ate virar gasto</td></tr>
          <tr><td><b>Gasto fixo</b> (aluguel, internet...)</td><td>conta quando aparece no extrato</td><td>sai da conta</td><td>diminui</td></tr>
        </tbody>
      </table>
      <p className="muted">Fixos e parcelas ficam em &quot;Ainda a pagar&quot; ate aparecer no mes um gasto com o mesmo valor (2%), em qualquer categoria.
        So use &quot;marcar pago&quot; se o pagamento nao vai aparecer em nenhum extrato importado. Lancamento repetido (mesmo valor, ate 3 dias)
        vem desmarcado na importacao.</p>
    </details>
  );
}

// Saldo em conta: o que sobra (ou falta) dos lancamentos entra no patrimonio como "Conta corrente"
export function AccountsPanel({ months, setup, m, onEdit }: { months: Record<string, MonthDoc>; setup: GastosSetup; m: string; onEdit?: (id: string | null) => void }) {
  const st = accountsStatus(months, setup, m);
  const [edit, setEdit] = useState<string | null>(null); // id da conta em edicao ou "__new"
  const accounts = accountsOf(setup);
  const saveAccounts = (list: Account[]) => saveSetup({ accounts: clean(list), account: null } as Partial<GastosSetup>);
  const beforeData = !!st.first && `${m}-31` < st.first;
  const isNow = m === monthOf(todayBR());
  return (
    <div className="accts small">
      <div className="accts-head">
        <b>Este mes</b>
        {beforeData ? <span className="muted">sem lancamentos neste mes ou antes</span> : (
          <span>
            inicio do mes <b>{brl(st.start)}</b> &rarr; {isNow ? "hoje" : "fim do mes"} <b className={st.end < 0 ? "neg" : ""}>{brl(st.end)}</b>
            <span className={st.end - st.start >= 0 ? "pos" : "neg"}> ({st.end - st.start >= 0 ? "+" : "-"}{brl(Math.abs(st.end - st.start))})</span>
          </span>
        )}
        <button className="link" onClick={() => (onEdit ? onEdit(null) : setEdit("__new"))}>+ conta</button>
      </div>
      <ul>
        {st.rows.map((r) => (
          <li key={r.acc.id}>
            <span className="acc-name">{r.acc.name}</span>
            <span><b className={r.now < 0 ? "neg" : ""}>{brl(r.now)}</b> <span className="muted">hoje</span></span>
            <span className={r.informed ? "muted" : "warn"}>
              {r.acc.noStatement ? `sem extrato: ${r.now > 0.005 ? `${brl(r.now)} recebidos ainda a discriminar (lance o que foi pago com "Pago com: ${r.acc.name}")` : "tudo discriminado"}`
                : r.acc.at ? `saldo conferido em ${dm(r.acc.at)}; o resto vem dos lancamentos` : r.used ? "sem saldo conferido: so o movimento desde o 1o lancamento" : "sem lancamentos"}
            </span>
            <button className="link" onClick={() => (onEdit ? onEdit(r.acc.id) : setEdit(r.acc.id))}>{onEdit ? "alterar" : r.acc.noStatement ? "editar" : r.informed ? "conferir saldo" : "informar saldo"}</button>
          </li>
        ))}
      </ul>
      {edit && (
        <AccountForm acc={edit === "__new" ? null : accounts.find((a) => a.id === edit)!} canRemove={edit !== "__new" && accounts.length > 1 && !st.rows.find((r) => r.acc.id === edit)?.used}
          onCancel={() => setEdit(null)}
          onRemove={async () => { await saveAccounts(accounts.filter((a) => a.id !== edit)); setEdit(null); }}
          onSave={async (a) => {
            const base = setup.accounts?.length ? accounts : accounts.map((x) => ({ ...x }));
            await saveAccounts(base.some((x) => x.id === a.id) ? base.map((x) => (x.id === a.id ? a : x)) : [...base, a]);
            setEdit(null);
          }} />
      )}
      <p className="muted">O total das contas entra no patrimonio como &quot;Conta corrente&quot;. Confira o saldo de vez em quando com o app do banco:
        o site recalcula todos os meses a partir dele.</p>
    </div>
  );
}

export function AccountForm({ acc, canRemove, onSave, onCancel, onRemove }: {
  acc: Account | null; canRemove: boolean; onSave: (a: Account) => void; onCancel: () => void; onRemove: () => void;
}) {
  const [name, setName] = useState(acc?.name ?? "");
  const [bal, setBal] = useState(acc?.balance !== undefined ? fmt(acc.balance) : "");
  const [at, setAt] = useState(todayBR());
  const [noSt, setNoSt] = useState(!!acc?.noStatement);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const t = bal.trim();
    const { balance: _b, at: _a, noStatement: _n, ...rest } = acc ?? { id: newId(), name: "" };
    onSave({ ...rest, id: acc?.id ?? newId(), name: name.trim(), ...(noSt ? { noStatement: true } : t ? { balance: num(t.replace(/\u2212/g, "-")), at } : {}) });
  };
  return (
    <form className="row wrapline acct-form" onSubmit={submit}>
      <label>Conta<input value={name} onChange={(e) => setName(e.target.value)} placeholder="PicPay, Nubank..." /></label>
      <label className="check"><input type="checkbox" checked={noSt} onChange={(e) => setNoSt(e.target.checked)} /> Conta sem extrato (comeca do zero)</label>
      {!noSt && <>
      <label>Saldo no app do banco (R$)<input value={bal} inputMode="decimal" onChange={(e) => setBal(e.target.value)} placeholder="ex.: 1.250,00" /></label>
      <label>No fim do dia<input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      </>}
      <button className="primary" type="submit">Salvar</button>
      <button className="ghost" type="button" onClick={onCancel}>Cancelar</button>
      {canRemove && <button className="ghost" type="button" onClick={onRemove}>remover conta</button>}
      <span className="muted">O saldo vale para o fim do dia escolhido: lancamentos ate esse dia ja estao nele, os seguintes somam ou descontam,
        e os meses anteriores sao recalculados de tras para frente. Deixe vazio para mostrar so o movimento.</span>
    </form>
  );
}

// Lancamento rapido: categoria sugerida pela descricao; no cartao pode ser parcelado
export function QuickAdd({ months, setup, invest, defaultDate, mode = "conta", onAdded }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; defaultDate: string; mode?: "conta" | "cartao";
  onAdded?: (card: string, d: string) => void; // compra no cartao lancada: mostra a fatura onde ela caiu
}) {
  const [done, setDone] = useState("");
  const [d, setD] = useState(defaultDate);
  const [desc, setDesc] = useState("");
  const [v, setV] = useState("");
  const [entrada, setEntrada] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const accs = accountsOf(setup);
  const [src, setSrc] = useState(mode === "cartao" && setup.cards[0] ? `card:${setup.cards[0].id}` : `acc:${accs[0].id}`); // "acc:id" ou "card:id"
  const card = src.startsWith("card:") ? src.slice(5) : "";
  const acc = src.startsWith("acc:") ? src.slice(4) : "";
  const [n, setN] = useState("1");
  const [busy, setBusy] = useState(false);
  const auto = categorize(desc, entrada, setup.rules);
  const finalCat = cat ?? auto.cat;
  const [inv, setInv] = useState<string | null>(null);
  const finalInv = finalCat === INVEST_CAT ? (inv ?? suggestInv(desc, invest, setup.invRules) ?? "") : "";
  const [payCard, setPayCard] = useState<string | null>(null);
  const [toAcc, setToAcc] = useState<string | null>(null);
  const finalPay = finalCat === CARD_PAY_CAT ? (payCard ?? suggestCard(desc, num(v), setup.cards, months) ?? "") : "";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = num(v);
    if (!desc.trim() || !(total > 0)) return;
    setBusy(true);
    const tipo: Tipo = tipoOfCat(finalCat) ?? (entrada ? "receita" : "gasto");
    const parcels = card && !entrada ? Math.max(1, Math.min(48, Math.round(num(n)) || 1)) : 1;
    const each = Math.round((total / parcels) * 100) / 100;
    const list: Gasto[] = Array.from({ length: parcels }, (_, k) => ({
      id: newId(), d: dayIn(addMonths(monthOf(d), k), Number(d.slice(8, 10))), desc: desc.trim(), v: each, tipo, io: entrada ? "in" as const : "out" as const, cat: finalCat, src: "manual" as const,
      ...(card ? { card } : acc ? { acc } : {}), ...(parcels > 1 ? { parc: [k + 1, parcels] as [number, number] } : {}),
    }));
    const target = finalInv === "__new" ? await createBox(invest, desc, d) : finalInv || undefined;
    const dest = finalCat === TRANSFER_CAT && !card ? (toAcc === "__new" ? await createEnvelope(setup, desc) : toAcc || undefined) : undefined;
    await addItems(months, list.map((x) => ({ ...x, ...(target ? { inv: target } : {}), ...(finalPay && !card ? { payCard: finalPay } : {}), ...(dest && dest !== acc ? { toAcc: dest } : {}) })));
    if (cat && descKey(desc)) await saveSetup({ rules: { ...setup.rules, [descKey(desc)]: cat } });
    if (inv && target && descKey(desc)) await saveSetup({ invRules: { ...(setup.invRules ?? {}), [descKey(desc)]: target } });
    if (card) {
      const c = setup.cards.find((x) => x.id === card);
      if (c) setDone(`${desc.trim()} (${brl(total)}${parcels > 1 ? ` em ${parcels}x` : ""}) lancada na fatura de ${monthLabel(faturaMonth(c, d))} do ${c.name}${parcels > 1 ? ` ate ${monthLabel(faturaMonth(c, list[parcels - 1].d))}` : ""}.`);
      onAdded?.(card, d);
    }
    setDesc(""); setV(""); setCat(null); setInv(null); setToAcc(null); setN("1"); setBusy(false);
  };
  return (
    <form className="fin-form quick" onSubmit={submit}>
      {mode === "conta" && <div className="kind-pick">
        <button type="button" className={!entrada ? "pill on" : "pill"} onClick={() => { setEntrada(false); setCat(null); }}>Gasto</button>
        <button type="button" className={entrada ? "pill on" : "pill"} onClick={() => { setEntrada(true); setCat(null); if (card) setSrc(`acc:${accs[0].id}`); }}>Entrada</button>
      </div>}
      <div className="row wrapline">
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="grow">Descricao<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={entrada ? "Salario" : "Mercado, ifood, aluguel..."} /></label>
        <label>Valor (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder="0,00" /></label>
        <label>Categoria<CatSelect value={finalCat} onChange={setCat} /></label>
        {finalCat === TRANSFER_CAT && <label>{entrada ? "Veio de" : "Foi para"}<ToAccSelect value={toAcc ?? suggestToAcc(desc, acc || null, setup) ?? ""} from={acc || null} out={!entrada} setup={setup} onChange={setToAcc} /></label>}
        {finalCat === CARD_PAY_CAT && setup.cards.length > 0 && <label>Cartao pago<CardPaySelect value={finalPay} cards={setup.cards} onChange={setPayCard} /></label>}
        {finalCat === INVEST_CAT && <label>{entrada ? "Veio de" : "Foi para"}<InvSelect value={finalInv} desc={desc} invest={invest} out={!entrada} onChange={setInv} /></label>}
        <label>{mode === "cartao" ? "Cartao" : entrada ? "Entrou em" : "Pago com"}
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            {mode === "conta" && accs.map((a) => <option key={a.id} value={`acc:${a.id}`}>{entrada ? a.name : `${a.name} (debito / Pix)`}</option>)}
            {mode === "cartao" && setup.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}
          </select>
        </label>
        {card && !entrada && <label>Parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 70 }} /></label>}
        <button type="submit" className="primary" disabled={busy || !desc.trim() || !(num(v) > 0)}>Lancar</button>
      </div>
      {card && num(n) > 1 && num(v) > 0 && <p className="muted small">{Math.round(num(n))}x de {brl(num(v) / Math.round(num(n)))} - uma parcela em cada mes.</p>}
      {done && <p className="small pos">{done}</p>}
    </form>
  );
}

// Importar extrato OFX ou CSV: tudo e lido no seu navegador; so os lancamentos escolhidos sao gravados
export function ImportPanel({ months, setup, invest, onDone, mode = "conta" }: {
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; onDone: () => void; mode?: "conta" | "cartao";
}) {
  type Row = Raw & { on: boolean; cat: string; tipo: Tipo; inv?: string; payCard?: string; toAcc?: string; dup: "" | "ja importado" | "parece repetido" };
  const [rows, setRows] = useState<Row[]>([]);
  const [file, setFile] = useState("");
  const [err, setErr] = useState("");
  const accs = accountsOf(setup);
  const implicit = !setup.accounts?.length; // ainda so existe a "Conta principal" automatica
  const [dest, setDest] = useState(mode === "cartao" && setup.cards[0] ? `card:${setup.cards[0].id}` : `acc:${accs[0].id}`); // "acc:id", "card:id" ou "new"
  const [cardHint, setCardHint] = useState(false);
  const [newName, setNewName] = useState("");
  const [bank, setBank] = useState<string | null>(null);
  const [fileBal, setFileBal] = useState<{ v: number; d: string } | null>(null);
  const [useBal, setUseBal] = useState(true);
  const card = dest.startsWith("card:") ? dest.slice(5) : "";
  const [busy, setBusy] = useState(false);
  const [ownName, setOwnName] = useState(setup.ownName ?? "");
  const [info, setInfo] = useState("");
  const all = Object.values(months).flatMap((md) => md.items);
  const exts = new Set(all.map((g) => g.ext).filter(Boolean));
  const build = (raw: Raw[]): Row[] => raw.map((r) => {
    const { cat, tipo } = categorize(r.desc, r.amount > 0, setup.rules, ownName);
    const dup = exts.has(r.ext) ? "ja importado" as const
      : looksDuplicate(r.d, Math.abs(r.amount), all) ? "parece repetido" as const : "" as const;
    const inv = cat === INVEST_CAT ? suggestInv(r.desc, invest, setup.invRules) : undefined;
    const payCard = cat === CARD_PAY_CAT ? suggestCard(r.desc, Math.abs(r.amount), setup.cards, months) : undefined;
    const toAcc = cat === TRANSFER_CAT ? suggestToAcc(r.desc, null, setup) : undefined;
    return { ...r, cat, tipo, inv, payCard, toAcc, dup, on: !dup };
  });
  const onFile = async (f: File) => {
    setErr("");
    setInfo("");
    setFile(f.name);
    const text = decode(await f.arrayBuffer());
    const b = guessBank(text, f.name);
    setBank(b);
    // Conta de destino: cartao (fatura), a conta com o nome do banco, a "Conta principal" automatica (vira o banco) ou uma nova
    const pickAccount = (isCard: boolean) => {
      setCardHint(mode === "conta" && isCard);
      if (mode === "cartao") {
        const byName = !b ? undefined : setup.cards.find((c) => plain(c.name).includes(plain(b)) || plain(b).includes(plain(c.name)));
        return setDest(`card:${(byName ?? setup.cards[0])?.id}`);
      }
      const match = b && accs.find((a) => plain(a.name).includes(plain(b)) || plain(b).includes(plain(a.name)));
      if (match) return setDest(`acc:${match.id}`);
      if (implicit || !b) return setDest(`acc:${accs[0].id}`);
      setNewName(b);
      setDest("new");
    };
    if (/<OFX>|OFXHEADER/i.test(text)) {
      const raw = parseOFX(text);
      if (!raw.length) return setErr("Nenhum lancamento encontrado no OFX.");
      const isCard = /<CREDITCARDMSGSRSV1>/i.test(text);
      pickAccount(isCard);
      setFileBal(isCard ? null : ofxBalance(text));
      setRows(build(raw));
    } else {
      const r = parseCSV(text);
      if (r.error) return setErr(`CSV: ${r.error}. Se puder, exporte em OFX ou me mande o modelo do banco.`);
      setInfo(r.info ?? "");
      pickAccount(r.cardStyle);
      setFileBal(r.balance ?? null);
      setRows(build(r.rows));
    }
    setUseBal(true);
  };
  const invert = () => setRows(build(rows.map((r) => ({ ...r, amount: -r.amount }))));
  const chosen = rows.filter((r) => r.on);
  // Conta que recebe os lancamentos (cria a nova / renomeia a automatica) e saldo do extrato, se houver
  const targetId = dest === "new" ? "__new" : dest.startsWith("acc:") ? dest.slice(4) : null;
  const target = targetId && targetId !== "__new" ? accs.find((a) => a.id === targetId) : null;
  const renameTo = implicit && target?.id === "main" && bank ? bank : null;
  const balNewer = !!fileBal && (!target?.at || target.at <= fileBal.d);
  const save = async () => {
    setBusy(true);
    if ((setup.ownName ?? "") !== ownName.trim()) await saveSetup({ ownName: ownName.trim() });
    let accId: string | null = null;
    if (targetId) {
      let list = accs.map((a) => ({ ...a }));
      if (targetId === "__new") {
        accId = newId();
        list.push({ id: accId, name: newName.trim() || bank || "Conta" });
      } else accId = targetId;
      if (renameTo) list = list.map((a) => (a.id === accId ? { ...a, name: renameTo } : a));
      if (fileBal && useBal && (targetId === "__new" || balNewer)) list = list.map((a) => (a.id === accId ? { ...a, balance: fileBal.v, at: fileBal.d } : a));
      await saveSetup({ accounts: clean(list), account: null } as Partial<GastosSetup>);
    }
    await addItems(months, chosen.map((r) => ({
      ...(r.inv && r.cat === INVEST_CAT ? { inv: r.inv } : {}),
      ...(r.payCard && r.cat === CARD_PAY_CAT && !card ? { payCard: r.payCard } : {}),
      ...(r.toAcc && r.cat === TRANSFER_CAT && !card && r.toAcc !== accId ? { toAcc: r.toAcc } : {}),
      id: newId(), d: r.d, desc: r.desc, v: Math.abs(r.amount), tipo: r.tipo, io: r.amount > 0 ? "in" as const : "out" as const, cat: r.cat, src: "import" as const, ext: r.ext,
      ...(card ? { card } : accId ? { acc: accId } : {}), ...(parcOf(r.desc) ? { parc: parcOf(r.desc) } : {}),
    })));
    setBusy(false);
    onDone();
  };
  const setRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const out = chosen.filter((r) => r.tipo === "gasto").reduce((s, r) => s + Math.abs(r.amount), 0);
  const inn = chosen.filter((r) => r.tipo === "receita").reduce((s, r) => s + Math.abs(r.amount), 0);
  return (
    <div className="fin-form">
      <p className="small">No app do banco, exporte o extrato ou a fatura em <b>OFX</b> (quase todos os bancos) ou <b>CSV</b> (PicPay, Nubank, Inter, Itau, Bradesco, BB, C6, Mercado Pago...) e escolha o arquivo.
        Ele e lido aqui no navegador; nada e enviado para o banco e nenhuma senha e pedida.</p>
      <div className="row wrapline">
        <label className="file-btn">Escolher arquivo<input type="file" accept=".ofx,.csv,.txt,.qfx" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        <span className="muted small">{file}</span>
        <label>De onde e<select value={dest} onChange={(e) => setDest(e.target.value)}>
          {mode === "conta" && accs.map((a) => <option key={a.id} value={`acc:${a.id}`}>Conta {renameTo && a.id === "main" ? renameTo : a.name}</option>)}
          {mode === "cartao" && setup.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>Fatura do cartao {c.name}</option>)}
          {mode === "conta" && <option value="new">+ nova conta{bank ? `: ${bank}` : ""}</option>}
        </select></label>
        {dest === "new" && <label>Nome da conta<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={bank ?? "Nubank, Inter..."} /></label>}
        {rows.length > 0 && <button type="button" className="ghost small-btn" onClick={invert}>inverter sinais</button>}
      </div>
      <div className="row wrapline">
        <label className="grow">Seu nome como aparece no extrato (Pix entre suas contas nao conta como gasto)
          <input value={ownName} onChange={(e) => setOwnName(e.target.value)} onBlur={() => rows.length && setRows(build(rows))} placeholder="Nome Sobrenome" autoComplete="off" />
        </label>
      </div>
      {err && <p className="error small">{err}</p>}
      {cardHint && <p className="warn small">Este arquivo parece uma fatura de cartao: importe em Financas &rarr; Cartoes e emprestimos (aqui ficam so as contas).</p>}
      {rows.length > 0 && (
        <>
          {info && <p className="muted small">Lido: {info}{bank ? ` - banco: ${bank}` : ""}.</p>}
          {renameTo && <p className="small">A &quot;Conta principal&quot; passa a se chamar <b>{renameTo}</b> (os lancamentos dela continuam la).</p>}
          {targetId && fileBal && (dest === "new" || balNewer) && (
            <label className="check small"><input type="checkbox" checked={useBal} onChange={(e) => setUseBal(e.target.checked)} />
              Usar o saldo do extrato como saldo conferido da conta: <b>{brl(fileBal.v)}</b> no fim de {dm(fileBal.d)}</label>
          )}
          {targetId && !fileBal && <p className="muted small">Este arquivo nao traz o saldo. Depois de importar, informe o saldo atual da conta em &quot;Contas&quot;
            (uma vez so: depois o site recalcula sozinho).</p>}
          <p className="small">{rows.length} lancamentos no arquivo - {chosen.length} marcados: gastos {brl(out)}, entradas {brl(inn)}.
            {rows.some((r) => r.dup) && <span className="muted"> Os ja importados ou repetidos vieram desmarcados.</span>}</p>
          <div className="table-scroll import-list">
            <table className="stack gastos">
              <thead><tr><th /><th>Data</th><th>Descricao</th><th>Categoria</th><th>Valor</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ext}${i}`} className={r.on ? "" : "off"}>
                    <td><input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} aria-label="Importar" /></td>
                    <td data-label="Data">{dm(r.d)}</td>
                    <td data-label="Descricao"><span className="cell">{r.desc}{r.dup && <small className="warn">{r.dup}</small>}</span></td>
                    <td data-label="Categoria"><span className="cell">
                      <CatSelect value={r.cat} onChange={(c) => setRow(i, { cat: c, tipo: tipoOfCat(c) ?? r.tipo, inv: c === INVEST_CAT ? suggestInv(r.desc, invest, setup.invRules) : undefined,
                        payCard: c === CARD_PAY_CAT ? suggestCard(r.desc, Math.abs(r.amount), setup.cards, months) : undefined,
                        toAcc: c === TRANSFER_CAT ? suggestToAcc(r.desc, null, setup) : undefined })} />
                      {r.cat === TRANSFER_CAT && !card && <ToAccSelect value={r.toAcc} from={targetId && targetId !== "__new" ? targetId : null} out={r.amount < 0} setup={setup} onChange={async (id) => {
                        const target = id === "__new" ? await createEnvelope(setup, r.desc) : id || undefined;
                        const key = descKey(r.desc);
                        setRows((rs) => rs.map((x, k) => (k === i || (key && x.cat === TRANSFER_CAT && descKey(x.desc) === key) ? { ...x, toAcc: target } : x)));
                        if (key && target) await saveSetup({ accRules: { ...(setup.accRules ?? {}), [key]: target } });
                      }} />}
                      {r.cat === CARD_PAY_CAT && !card && setup.cards.length > 0 && <CardPaySelect value={r.payCard} cards={setup.cards} onChange={(id) => setRow(i, { payCard: id || undefined })} />}
                      {r.cat === INVEST_CAT && <InvSelect value={r.inv} desc={r.desc} invest={invest} out={r.amount < 0} onChange={async (id) => {
                        const target = id === "__new" ? await createBox(invest, r.desc, r.d) : id || undefined;
                        const key = descKey(r.desc);
                        // mesmo destino para os iguais do arquivo, e lembrado para as proximas importacoes
                        setRows((rs) => rs.map((x, k) => (k === i || (key && x.cat === INVEST_CAT && descKey(x.desc) === key) ? { ...x, inv: target } : x)));
                        if (key && target) await saveSetup({ invRules: { ...(setup.invRules ?? {}), [key]: target } });
                      }} />}
                    </span></td>
                    <td data-label="Valor" className={r.tipo === "receita" ? "pos" : r.tipo === "neutro" ? "muted" : ""}>{r.amount > 0 ? "+" : "-"}{brl(Math.abs(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="primary" disabled={busy || !chosen.length} onClick={save}>{busy ? "Gravando..." : `Importar ${chosen.length} lancamentos`}</button>
            <button className="ghost" onClick={onDone}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

// Colunas por mes: gastos x entradas (ultimos 6 meses ate o mes aberto)
function MonthsChart({ months, current, onPick }: { months: Record<string, MonthDoc>; current: string; onPick: (m: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const list = Array.from({ length: 6 }, (_, i) => addMonths(current, i - 5)).map((m) => ({ m, ...summarize(months[m]?.items ?? []) }));
  const max = Math.max(...list.map((x) => Math.max(x.gastos, x.receitas)), 0);
  if (!(max > 0) || list.filter((x) => x.gastos + x.receitas > 0).length < 2) return null;
  const h = hover !== null ? list[hover] : null;
  return (
    <figure className="viz">
      <figcaption className="small muted">
        Ultimos 6 meses <i className="key k-in" /> entradas <i className="key k-out" /> gastos
        {h ? ` - ${monthLabel(h.m)}: entradas ${brl(h.receitas, 0)}, gastos ${brl(h.gastos, 0)}` : ""}
      </figcaption>
      <div className="mbars six" onMouseLeave={() => setHover(null)}>
        {list.map((x, i) => (
          <div key={x.m} className={`mbar pair${hover !== null && hover !== i ? " dim" : ""}${x.m === current ? " cur" : ""}`}
            onMouseEnter={() => setHover(i)} onClick={() => onPick(x.m)} title={`${monthLabel(x.m)}: entradas ${brl(x.receitas)}, gastos ${brl(x.gastos)}`}>
            <span className="pair-bars">
              <span className="mbar-fill in" style={{ height: `${(x.receitas / max) * 100}%` }} />
              <span className="mbar-fill out" style={{ height: `${(x.gastos / max) * 100}%` }} />
            </span>
            <small>{monthLabel(x.m)}</small>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Cards({ cards, setup, onEdit }: { cards: { c: Card; st: ReturnType<typeof cardStatus> }[]; setup: GastosSetup; onEdit?: (id: string | null) => void }) {
  const [form, setForm] = useState<Card | null>(null);
  const save = async (c: Card) => {
    await saveSetup({ cards: setup.cards.some((x) => x.id === c.id) ? setup.cards.map((x) => (x.id === c.id ? c : x)) : [...setup.cards, c] });
    setForm(null);
  };
  const remove = async (c: Card) => {
    if (confirm(`Remover o cartao ${c.name}? (os lancamentos continuam)`)) await saveSetup({ cards: setup.cards.filter((x) => x.id !== c.id) });
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Cartoes</h2>{!form && <button className="ghost small-btn" onClick={() => (onEdit ? onEdit(null) : setForm({ id: newId(), name: "", closeDay: 1, dueDay: 8 }))}>+ cartao</button>}</div>
      {form && <CardForm c={form} onSave={save} onCancel={() => setForm(null)} />}
      {cards.length ? cards.map(({ c, st }) => (
        <div key={c.id} className="debt">
          <div className="row between">
            <b>{c.name}</b>
            <span className="muted small">fecha dia {c.closeDay}, vence dia {c.dueDay}
              {onEdit ? <button className="link" onClick={() => onEdit(c.id)}>alterar</button>
                : <><button className="link" onClick={() => setForm(c)}>editar</button><button className="link" onClick={() => remove(c)}>remover</button></>}</span>
          </div>
          {st.overdue.map((f) => <p key={f.m} className="small warn">Fatura de {monthLabel(f.m)} vencida em {dm(f.due)}: {brl(f.rest)} sem pagamento lancado</p>)}
          {st.next ? (
            <p className="small">Proxima fatura: <b>{brl(st.next.v)}</b> vence {dm(st.next.due)} <span className="muted">({st.next.status === "fechada" ? "fechada" : "ainda aberta"})</span>
              {(() => {
                const later = st.faturas.filter((f) => f.status !== "vencida" && f.m > st.next!.m);
                return later.length ? <span className="muted"> - depois: {later.slice(0, 3).map((f) => `${monthLabel(f.m)} ${brl(f.v, 0)}`).join(", ")}{later.length > 3 ? "..." : ""}</span> : null;
              })()}</p>
          ) : <p className="muted small">Sem fatura em aberto lancada.</p>}
          {(() => {
            const last = [...st.all].reverse().find((f) => f.status === "paga");
            return last ? <p className="muted small">Ultima paga: {monthLabel(last.m)} ({brl(last.v)})</p> : null;
          })()}
          {c.limit ? (
            <div className="limit" title={`${brl(st.open)} de ${brl(c.limit)}`}>
              <span className={st.open > c.limit * 0.8 ? "limit-fill high" : "limit-fill"} style={{ width: `${Math.min(100, (st.open / c.limit) * 100)}%` }} />
              <small className="muted">limite usado {fmt((st.open / c.limit) * 100, 0)}% ({brl(st.open, 0)} de {brl(c.limit, 0)})</small>
            </div>
          ) : st.open > 0 ? <p className="muted small">Em aberto (com parcelas futuras): {brl(st.open)}</p> : null}
        </div>
      )) : !form && <p className="muted small">Cadastre seus cartoes para ver a fatura de cada um e as parcelas que ainda vem.</p>}
      {cards.length > 0 && <p className="muted small">A divida do cartao baixa quando o pagamento da fatura aparece no extrato da conta (ou na propria fatura).
        Se pagar antes do vencimento, ja sai da divida no dia.</p>}
    </section>
  );
}

export function CardForm({ c, onSave, onCancel }: { c: Card; onSave: (c: Card) => void; onCancel: () => void }) {
  const [name, setName] = useState(c.name);
  const [close, setClose] = useState(String(c.closeDay));
  const [due, setDue] = useState(String(c.dueDay));
  const [limit, setLimit] = useState(c.limit ? fmt(c.limit, 0) : "");
  const [budget, setBudget] = useState(c.budget ? fmt(c.budget, 0) : "");
  const day = (s: string) => Math.max(1, Math.min(31, Math.round(num(s)) || 1));
  return (
    <form className="fin-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { const { limit: _l, budget: _b, ...rest } = c; void _l; void _b; onSave({ ...rest, name: name.trim(), closeDay: day(close), dueDay: day(due), ...(num(limit) > 0 ? { limit: num(limit) } : {}), ...(num(budget) > 0 ? { budget: num(budget) } : {}) }); } }}>
      <div className="row wrapline">
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nubank" /></label>
        <label>Dia que fecha<input value={close} inputMode="numeric" onChange={(e) => setClose(e.target.value)} style={{ width: 70 }} /></label>
        <label>Dia que vence<input value={due} inputMode="numeric" onChange={(e) => setDue(e.target.value)} style={{ width: 70 }} /></label>
        <label>Limite (opcional)<input value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} /></label>
        <label>Planejado por fatura (opcional)<input value={budget} inputMode="decimal" onChange={(e) => setBudget(e.target.value)} placeholder="ex.: 1.500" /></label>
      </div>
      <div className="row"><button className="primary" type="submit">Salvar</button><button className="ghost" type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

export function Loans({ setup, months, onEdit, onPrepay }: { setup: GastosSetup; months?: Record<string, MonthDoc>; onEdit?: (id: string | null) => void; onPrepay?: (id: string) => void }) {
  const [form, setForm] = useState<Loan | null>(null);
  const today = todayBR();
  const save = async (l: Loan) => {
    await saveSetup({ loans: setup.loans.some((x) => x.id === l.id) ? setup.loans.map((x) => (x.id === l.id ? l : x)) : [...setup.loans, l] });
    setForm(null);
  };
  const remove = async (l: Loan) => {
    if (confirm(`Remover ${l.name}?`)) await saveSetup({ loans: setup.loans.filter((x) => x.id !== l.id) });
  };
  const list = setup.loans.map((l) => ({ l, st: loanStatus(l, today, months ? { months, setup } : undefined) }));
  const total = list.reduce((s, x) => s + x.st.saldo, 0);
  const monthly = list.filter((x) => x.st.left > 0).reduce((s, x) => s + x.l.parcela, 0);
  return (
    <section className="card">
      <div className="card-head"><h2>Emprestimos e financiamentos</h2>{!form && <button className="ghost small-btn" onClick={() => (onEdit ? onEdit(null) : setForm({ id: newId(), name: "", parcela: 0, n: 12, first: monthOf(today), dueDay: 10, paidBefore: 0 }))}>+ emprestimo</button>}</div>
      {form && <LoanForm l={form} onSave={save} onCancel={() => setForm(null)} />}
      {list.length > 0 && <p className="small">Devendo <b>{brl(total)}</b> - {brl(monthly)} por mes em parcelas.</p>}
      {list.map(({ l, st }) => (
        <div key={l.id} className="debt">
          <div className="row between">
            <b>{l.name}</b>
            <span className="muted small">{onPrepay && st.left > 0 && <button className="link" onClick={() => onPrepay(l.id)}>adiantar parcelas</button>}
              {onEdit ? <button className="link" onClick={() => onEdit(l.id)}>alterar</button>
              : <><button className="link" onClick={() => setForm(l)}>editar</button><button className="link" onClick={() => remove(l)}>remover</button></>}</span>
          </div>
          <div className="limit">
            <span className="limit-fill paid" style={{ width: `${(st.paid / l.n) * 100}%` }} />
            <small className="muted">{st.paid} de {l.n} parcelas pagas{st.prepaid ? ` (${st.prepaid} adiantadas)` : ""}{st.late ? `, ${st.late} atrasada${st.late > 1 ? "s" : ""}` : ""} - {st.left > 0 ? `termina em ${monthLabel(st.end, true)}` : "quitado"}
              {st.left > 0 && st.end !== st.originalEnd ? ` (era ${monthLabel(st.originalEnd, true)})` : ""}</small>
          </div>
          {st.saved > 0.005 && <p className="small pos">Economizou {brl(st.saved)} adiantando parcelas</p>}
          {st.left > 0 && <p className="small">Parcela {brl(l.parcela)} (dia {l.dueDay}) - saldo devedor {l.rate ? "" : "~"}{brl(st.saldo)}
            {l.rate ? <span className="muted"> com juros de {fmt(l.rate)}% ao mes</span> : <span className="muted"> (soma das parcelas; informe os juros para o valor de quitacao)</span>}</p>}
        </div>
      ))}
      {!list.length && !form && <p className="muted small">Cadastre emprestimos e financiamentos: a parcela entra sozinha no &quot;ainda a pagar&quot; de cada mes e a divida e descontada do patrimonio.</p>}
    </section>
  );
}

export function LoanForm({ l, onSave, onCancel }: { l: Loan; onSave: (l: Loan) => void; onCancel: () => void }) {
  const [name, setName] = useState(l.name);
  const [parcela, setParcela] = useState(l.parcela ? fmt(l.parcela) : "");
  const [n, setN] = useState(String(l.n));
  const [first, setFirst] = useState(l.first);
  const [due, setDue] = useState(String(l.dueDay));
  const [rate, setRate] = useState(l.rate ? String(l.rate).replace(".", ",") : "");
  return (
    <form className="fin-form" onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim() || !(num(parcela) > 0) || !(num(n) >= 1)) return;
      // mantem pagamentos, adiantamentos e parcelas ja pagas; so troca os dados do contrato
      const { rate: _r, ...rest } = l;
      void _r;
      onSave({ ...rest, name: name.trim(), parcela: num(parcela), n: Math.round(num(n)), first, dueDay: Math.max(1, Math.min(31, Math.round(num(due)) || 1)), ...(num(rate) > 0 ? { rate: num(rate) } : {}) });
    }}>
      <div className="row wrapline">
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Financiamento do carro" /></label>
        <label>Parcela (R$)<input value={parcela} inputMode="decimal" onChange={(e) => setParcela(e.target.value)} /></label>
        <label>Total de parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 80 }} /></label>
        <label>Mes da 1a parcela<input type="month" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label>Dia do vencimento<input value={due} inputMode="numeric" onChange={(e) => setDue(e.target.value)} style={{ width: 70 }} /></label>
        <label>Juros % ao mes (opcional)<input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder="1,99" /></label>
      </div>
      <div className="row"><button className="primary" type="submit">Salvar</button><button className="ghost" type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

// Lista dos gastos fixos (Contas e bens: so mostra)
export function Fixos({ setup, months, onEdit }: { setup: GastosSetup; months?: Record<string, MonthDoc>; onEdit?: (id: string | null) => void }) {
  const m = monthOf(todayBR());
  const val = (f: Fixo) => fixoExpected(f, m, months);
  const total = setup.fixos.filter((f) => fixoActive(f, m)).reduce((s, f) => s + val(f), 0);
  return (
    <section className="card">
      <div className="card-head"><h2>Gastos fixos</h2>
        <span className="muted small">{setup.fixos.length ? `~${brl(total)} por mes` : ""}{onEdit && <button className="link" onClick={() => onEdit(null)}>+ fixo</button>}</span></div>
      {setup.fixos.length > 0 ? (
        <ul className="pend small">
          {setup.fixos.map((f) => {
            const next = (f.steps ?? []).filter((x) => x.from > m).sort((x, y) => x.from.localeCompare(y.from))[0];
            return (
              <li key={f.id}><span className="muted">dia {f.dia}</span> <b>{f.desc}</b> <span className="muted">{f.cat}</span>
                {f.varia && <span className="tag">varia{months && fixoHistory(f, m, months).length ? ": media" : ""}</span>}
                {f.reaj && <span className={fixoReajPending(f, m) ? "tag warn" : "tag"}>reajuste em {monthLabel(`2000-${String(f.reaj).padStart(2, "0")}`).slice(0, 3)}</span>}
                {next && <span className="muted">{brl(next.v)} a partir de {monthLabel(next.from)}</span>}
                {f.start && f.start > m && <span className="tag">comeca em {monthLabel(f.start)}</span>}
                {f.end && <span className={f.end < m ? "tag warn" : "tag"}>{f.end < m ? "terminou" : "ate"} {monthLabel(f.end)}</span>}
                <span>{f.varia ? "~" : ""}{brl(val(f))}</span>
                {onEdit && <button className="link" onClick={() => onEdit(f.id)}>alterar</button>}</li>
            );
          })}
        </ul>
      ) : <p className="muted small">Nenhum gasto fixo cadastrado.</p>}
      <p className="muted small">Fixos aparecem em &quot;Previstos&quot; todo mes ate o pagamento aparecer: lancamento ligado a ele, mesmo valor (2%) ou,
        se o valor varia (luz, agua), um gasto da mesma categoria perto da media.</p>
    </section>
  );
}

const MES_OPTS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// Formulario do gasto fixo (Lancamentos): novo ou alterar/remover um existente
export function FixoForm({ setup, fixo, onDone }: { setup: GastosSetup; fixo: Fixo | null; onDone: (msg?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cur = monthOf(todayBR());
  const curV = fixo ? fixoValue(fixo, cur) : 0;
  const [desc, setDesc] = useState(fixo?.desc ?? "");
  const [v, setV] = useState(fixo ? fmt(curV) : "");
  const [from, setFrom] = useState(cur); // a partir de quando vale o novo valor ("" = so corrigir)
  const [dia, setDia] = useState(String(fixo?.dia ?? 10));
  const [cat, setCat] = useState<string | null>(fixo?.cat ?? null);
  const [varia, setVaria] = useState(!!fixo?.varia);
  const [reaj, setReaj] = useState(fixo?.reaj ?? 0);
  const [steps, setSteps] = useState(fixo?.steps ?? []);
  const [start, setStart] = useState(fixo ? fixo.start ?? "" : cur); // novo fixo comeca neste mes
  const [end, setEnd] = useState(fixo?.end ?? "");
  const monthOpts = (back: number, fwd: number) => Array.from({ length: back + fwd + 1 }, (_, i) => addMonths(cur, i - back));
  const finalCat = cat ?? categorize(desc, false, setup.rules).cat;
  const changed = !!fixo && Math.abs(num(v) - curV) > 0.005;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim() || !(num(v) > 0)) return;
    let base = fixo?.v ?? num(v);
    let st = [...steps];
    if (changed) {
      if (from) st = [...st.filter((x) => x.from !== from), { from, v: num(v) }];
      else {
        // corrigir: troca o valor do periodo atual
        const active = st.filter((x) => x.from <= cur).sort((x, y) => y.from.localeCompare(x.from))[0];
        if (active) st = st.map((x) => (x === active ? { ...x, v: num(v) } : x)); else base = num(v);
      }
    }
    st.sort((x, y) => x.from.localeCompare(y.from));
    if (start && end && end < start) { setErr("O mes de fim e antes do inicio."); return; }
    const { steps: _s, varia: _v, reaj: _r, start: _a, end: _b, ...rest } = fixo ?? ({} as Partial<Fixo>);
    void _s; void _v; void _r; void _a; void _b;
    const f: Fixo = { ...rest, id: fixo?.id ?? newId(), desc: desc.trim(), v: base, cat: finalCat, dia: Math.max(1, Math.min(31, Math.round(num(dia)) || 1)),
      ...(st.length ? { steps: st } : {}), ...(varia ? { varia: true } : {}), ...(reaj ? { reaj } : {}),
      ...(start ? { start } : {}), ...(end ? { end } : {}) };
    setBusy(true); setErr("");
    try {
      await saveSetup({ fixos: setup.fixos.some((x) => x.id === f.id) ? setup.fixos.map((x) => (x.id === f.id ? f : x)) : [...setup.fixos, f] });
    } catch {
      setBusy(false); setErr("Nao salvou (sem conexao?). Tente de novo.");
      return;
    }
    onDone(`${fixo ? "Salvo" : "Adicionado"}: ${f.desc}, ${f.varia ? "~" : ""}${brl(fixoValue(f, cur))} todo dia ${f.dia}${f.start ? `, a partir de ${monthLabel(f.start)}` : ""}${f.end ? ` ate ${monthLabel(f.end)}` : ""}. Ele aparece em Contas e bens > Gastos fixos e nos previstos do mes.`);
  };
  const remove = async () => {
    if (fixo && confirm(`Remover o fixo "${fixo.desc}"?`)) { await saveSetup({ fixos: setup.fixos.filter((x) => x.id !== fixo.id) }); onDone(`Removido: ${fixo.desc}.`); }
  };
  // historico: valor inicial e cada mudanca
  const hist = fixo ? [{ from: "", v: fixo.v }, ...steps] : [];
  return (
    <form className="fin-form" onSubmit={submit}>
      <div className="row wrapline">
        <label className="grow">Descricao<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Aluguel, internet, escola..." /></label>
        <label>{varia ? "Valor medio (R$)" : "Valor (R$)"}<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        {changed && (
          <label>Novo valor vale
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {Array.from({ length: 25 }, (_, i) => addMonths(cur, i - 12)).map((mm) => <option key={mm} value={mm}>a partir de {monthLabel(mm)}</option>)}
              <option value="">so corrigir (sempre foi esse)</option>
            </select>
          </label>
        )}
        <label>Dia<input value={dia} inputMode="numeric" onChange={(e) => setDia(e.target.value)} style={{ width: 60 }} /></label>
        <label>Categoria<CatSelect value={finalCat} onChange={setCat} /></label>
        <label>Comeca em
          <select value={start} onChange={(e) => setStart(e.target.value)}>
            <option value="">desde sempre</option>
            {start && !monthOpts(36, 24).includes(start) && <option value={start}>{monthLabel(start)}</option>}
            {monthOpts(36, 24).map((mm) => <option key={mm} value={mm}>{monthLabel(mm)}</option>)}
          </select>
        </label>
        <label>Termina em
          <select value={end} onChange={(e) => setEnd(e.target.value)}>
            <option value="">sem fim</option>
            {end && !monthOpts(36, 60).includes(end) && <option value={end}>{monthLabel(end)}</option>}
            {monthOpts(36, 60).filter((mm) => !start || mm >= start).map((mm) => <option key={mm} value={mm}>{monthLabel(mm)}</option>)}
          </select>
        </label>
        <label>Reajuste anual
          <select value={reaj} onChange={(e) => setReaj(Number(e.target.value))}>
            <option value={0}>nao tem</option>
            {MES_OPTS.map((x, i) => <option key={x} value={i + 1}>todo ano em {x}</option>)}
          </select>
        </label>
      </div>
      <label className="check small"><input type="checkbox" checked={varia} onChange={(e) => setVaria(e.target.checked)} />
        O valor muda todo mes (luz, agua, gas): a previsao usa a media dos ultimos 3 pagamentos</label>
      {hist.length > 1 && (
        <p className="small muted">Valores: {hist.map((x, i) => (
          <span key={x.from || "base"}>{i ? ", " : ""}{x.from ? `desde ${monthLabel(x.from)}` : "antes"} {brl(x.v)}
            {x.from && <button type="button" className="link" title="apagar esta mudanca" onClick={() => setSteps(steps.filter((y) => y.from !== x.from))}>x</button>}</span>
        ))}</p>
      )}
      {err && <p className="error small">{err}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy || !desc.trim() || !(num(v) > 0)}>{busy ? "Salvando..." : fixo ? "Salvar" : "Adicionar"}</button>
        {fixo && <button className="ghost" type="button" onClick={remove}>remover</button>}
      </div>
      <p className="muted small">Todo mes ele aparece em &quot;Previstos&quot; ate o pagamento aparecer num extrato. Mudou o valor (reajuste)? Altere aqui e
        diga a partir de quando: os meses anteriores continuam com o valor antigo.</p>
    </form>
  );
}
