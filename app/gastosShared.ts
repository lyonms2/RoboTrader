"use client";
// Funcoes de financas usadas tambem pela Visao geral (ficam fora dos componentes grandes, que carregam so quando a aba abre)
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { P, isReadOnly } from "@/lib/paths";
import {
  CARD_PAY_CAT, GENERIC_CATS, INVEST_CAT, accountsStatus, addMonths, avgMonthly, cardStatus, dirOf, faturaMonth, loanStatus, monthLabel, monthOf,
  pendingFor, summarize, todayBR, unmatchedTransfers, type Card, type Gasto, type GastosSetup, type MonthDoc,
} from "@/lib/gastos";
import { tell } from "./Dialog";

const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
// Modo suporte e so leitura: avisa e nao grava (as regras do banco tambem bloqueiam)
export function guardWrite() {
  if (!isReadOnly()) return;
  void tell("Modo suporte: só leitura. Nada foi alterado.");
  throw new Error("modo suporte: so leitura");
}
export const saveMonth = async (m: string, items: Gasto[]) => {
  guardWrite();
  return setDoc(doc(db(), P("config"), `gastos-${m}`), { items: clean([...items].sort((a, b) => a.d.localeCompare(b.d))) });
};
export const saveSetup = async (s: Partial<GastosSetup>) => {
  guardWrite();
  return setDoc(doc(db(), P("config"), "gastos-setup"), clean(s), { merge: true });
};

// Resumo do mes atual (para a pagina Resumo das Financas)
export function monthSnapshot(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const m = monthOf(todayBR());
  const items = months[m]?.items ?? [];
  const s = summarize(items, { m, months });
  const pending = pendingFor(m, items, setup, months);
  return { m, ...s, count: items.length, pending: pending.reduce((a, p) => a + p.v, 0), pendingN: pending.length, avg: avgMonthly(months) };
}

// Proximos pagamentos (Resumo): faturas, fixos e parcelas nos proximos 30 dias, mais o que ja venceu sem pagamento
export function upcoming(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const today = todayBR();
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const out: { d: string; desc: string; v: number; late: boolean; loan?: boolean; card?: boolean; once?: boolean }[] = [];
  for (const c of setup.cards) {
    const st = cardStatus(c, months);
    for (const f of st.overdue) out.push({ d: f.due, desc: `Fatura ${c.name} (${monthLabel(f.m)})`, v: f.rest, late: true, card: true });
    if (st.next && st.next.due <= limit) out.push({ d: st.next.due, desc: `Fatura ${c.name} (${st.next.status === "fechada" ? "fechada" : "ainda aberta"})`, v: st.next.v, late: false });
  }
  const m = monthOf(today);
  for (const mm of [m, addMonths(m, 1)])
    for (const p of pendingFor(mm, months[mm]?.items ?? [], setup, months))
      if (p.d <= limit && !p.card && !out.some((x) => x.once && x.desc === p.desc && x.d === p.d))
        out.push({ d: p.d, desc: p.desc, v: p.v, late: p.d < today, loan: !!p.parc, once: p.once });
  // parcelas de emprestimo de meses anteriores que continuam sem pagamento
  for (const l of setup.loans)
    for (const r of loanStatus(l, today, { months, setup }).rows)
      if (r.status === "atrasada" && r.m < m) out.push({ d: r.due, desc: `${l.name} (parcela ${r.k + 1}/${l.n})`, v: l.parcela, late: true, loan: true });
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

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

