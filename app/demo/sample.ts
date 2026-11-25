// Dados ficticios para a pagina de demonstracao (so em desenvolvimento). Nada aqui e de ninguem
import { DEFAULT_CONFIG } from "@/lib/types";
import { EMPTY_SETUP, addMonths, monthOf, todayBR, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import type { Demo } from "../Dashboard";

export function sampleDemo(member: boolean): Demo {
  const t = todayBR();
  const m = monthOf(t);
  const prev = addMonths(m, -1);
  const d = (mm: string, day: number) => `${mm}-${String(day).padStart(2, "0")}`;
  const months: Record<string, MonthDoc> = {
    [prev]: { items: [
      { id: "p1", d: d(prev, 5), desc: "Salario", v: 5200, tipo: "receita", cat: "Salario", io: "in" },
      { id: "p2", d: d(prev, 10), desc: "Aluguel", v: 1200, tipo: "gasto", cat: "Moradia" },
      { id: "p3", d: d(prev, 12), desc: "Supermercado", v: 640, tipo: "gasto", cat: "Mercado" },
      { id: "p4", d: d(prev, 15), desc: "Conta de luz", v: 132.4, tipo: "gasto", cat: "Contas (luz, agua, internet)" },
    ] },
    [m]: { items: [
      { id: "a1", d: d(m, 5), desc: "Salario", v: 5200, tipo: "receita", cat: "Salario", io: "in" },
      { id: "a2", d: d(m, 8), desc: "Pix aluguel", v: 1200, tipo: "gasto", cat: "Pix e transferencias" },
      { id: "a3", d: d(m, 10), desc: "Farmacia", v: 106, tipo: "gasto", cat: "Saude" },
      { id: "a4", d: d(m, 10), desc: "PAGAMENTO LUZ 123", v: 128.9, tipo: "gasto", cat: "Contas (luz, agua, internet)" },
      { id: "a5", d: d(m, 12), desc: "Supermercado", v: 356.24, tipo: "gasto", cat: "Mercado" },
      { id: "a6", d: d(m, 14), desc: "Loja de roupas", v: 140, tipo: "gasto", cat: "Compras", card: "c1", parc: [1, 3] },
      { id: "a7", d: d(m, 16), desc: "Restaurante", v: 86.5, tipo: "gasto", cat: "Alimentacao", card: "c1" },
    ] },
  };
  const setup: GastosSetup = {
    ...EMPTY_SETUP,
    cards: [{ id: "c1", name: "Cartão A", closeDay: 1, dueDay: 10, budget: 800 }, { id: "c2", name: "Cartão B", closeDay: 20, dueDay: 28 }],
    fixos: [
      { id: "f1", desc: "Aluguel", v: 1200, cat: "Moradia", dia: 10 },
      { id: "f2", desc: "Luz", v: 130, cat: "Contas (luz, agua, internet)", dia: 15, varia: true },
      { id: "f3", desc: "Academia", v: 107, cat: "Saude", dia: Math.min(28, Number(t.slice(8, 10)) + 1) },
      { id: "f4", desc: "Aluguel recebido", v: 900, cat: "Renda extra", dia: 28, entrada: true },
    ],
    budgets: { Moradia: 1300, Mercado: 900, Compras: 400 },
    loans: [{ id: "l1", name: "Empréstimo pessoal", parcela: 480, n: 24, first: addMonths(m, -6), dueDay: 15, paidBefore: 5 }],
    recvs: [{ id: "r1", name: "Pessoa A", kind: "emprestei", parcela: 200, n: 5, first: addMonths(m, -1), dueDay: 20, gotBefore: 1 }],
  };
  const cfg = { ...DEFAULT_CONFIG, finance: [
    { id: "i1", kind: "caixa" as const, name: "Cofrinho", balance: 6100, balanceAt: Date.now() - 40 * 86_400_000, cdiPct: 100, reserva: true },
    { id: "i2", kind: "outro" as const, name: "Previdência", value: 3200 },
    { id: "b1", kind: "bem" as const, name: "Carro", value: 38000, bemType: "veiculo" as const },
  ] };
  return {
    cfg, latest: [], trades: [], wallet: null, walletHistory: [], fichas: null, months, setup,
    ...(member ? { member: true, until: Date.now() + 4 * 86_400_000 } : {}),
  };
}
