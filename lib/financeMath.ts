import { walletTotals } from "./walletMath";
import type { FinanceDoc, FinItem, WalletDoc } from "./types";

// Contas das financas (roda no navegador): valor de cada investimento em R$, rendimento estimado e composicao
export type FinGroup = "reserva" | "conta" | "rendafixa" | "acoes" | "fiis" | "outro" | "cripto" | "dolar" | "bens";
export const GROUPS: { key: FinGroup; label: string }[] = [
  { key: "reserva", label: "Reserva" }, { key: "conta", label: "Conta corrente" }, { key: "rendafixa", label: "Renda fixa" }, { key: "acoes", label: "Ações e ETFs" },
  { key: "fiis", label: "FIIs" }, { key: "cripto", label: "Cripto" }, { key: "dolar", label: "Dólar (cripto)" },
  { key: "outro", label: "Outros" }, { key: "bens", label: "Bens (imóveis, veículos)" },
];

export type FinRow = {
  item: FinItem;
  group: FinGroup;
  kindLabel: string;
  value: number | null; // R$ hoje
  cost: number | null; // R$ aplicado (preco medio x qtd, ou saldo informado no cofrinho)
  price: number | null; // preco unitario atual
  change: number | null; // variacao do dia (acoes)
  monthly: number | null; // renda/rendimento estimado por mes, R$
  yieldYear: number | null; // taxa ao ano usada na estimativa (CDI x %, taxa do titulo, dividendos 12 m / preco)
  note: string;
  problem: string | null; // por que nao ha valor
  stale: string | null; // aviso de valor desatualizado
};

const DAY = 86_400_000;
const fmtD = (t: number) => new Date(t).toLocaleDateString("pt-BR");
const fmtP = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
// Dia no horario de Brasilia (AAAA-MM-DD)
export const dayBR = (t: number) => new Date(t - 3 * 3_600_000).toISOString().slice(0, 10);
const brToIso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

export const cdiDaily = (f: FinanceDoc | null) => (f?.cdi.v.length ? f.cdi.v[f.cdi.v.length - 1] / 100 : null);
export const cdiYear = (f: FinanceDoc | null) => {
  const d = cdiDaily(f);
  return d === null ? null : (1 + d) ** 252 - 1;
};

// Fator de rendimento de um % do CDI nos dias uteis depois de "from" (sem IR)
export function cdiFactor(f: FinanceDoc, from: string, pct: number) {
  let fac = 1;
  for (let i = 0; i < f.cdi.d.length; i++) if (f.cdi.d[i] > from) fac *= 1 + (f.cdi.v[i] / 100) * pct;
  return fac;
}

// Proventos por cota nos ultimos 12 meses
export const divs12m = (divs: { t: number; v: number }[], now = Date.now()) =>
  divs.filter((d) => d.t > now - 365 * DAY && d.t <= now).reduce((s, d) => s + d.v, 0);

// flows = depositos (+) e resgates (-) lancados em Entradas e saidas e ligados a este investimento
export type Flow = { d: string; v: number };
export function financeRow(item: FinItem, f: FinanceDoc | null, flows: Flow[] = []): FinRow {
  const base: FinRow = {
    item, group: item.reserva ? "reserva" : "outro", kindLabel: "", value: null, cost: null, price: null, change: null,
    monthly: null, yieldYear: null, note: "", problem: null, stale: null,
  };
  const monthlyOf = (value: number, year: number) => value * ((1 + year) ** (1 / 12) - 1);
  if (item.kind === "caixa") {
    const r = { ...base, kindLabel: "Conta / cofrinho", group: item.reserva ? "reserva" : "rendafixa" } as FinRow;
    const bal = item.balance ?? 0;
    const pct = (item.cdiPct ?? 100) / 100;
    const at = item.balanceAt ?? Date.now();
    // Depositos/resgates depois da data do saldo: cada um rende CDI a partir do proprio dia
    const fl = flows.filter((x) => x.d > dayBR(at));
    const net = fl.reduce((s, x) => s + x.v, 0);
    const moved = fl.length ? ` + ${fl.length} ${fl.length > 1 ? "movimentos" : "movimento"} (${net >= 0 ? "+" : "-"}R$ ${Math.abs(net).toLocaleString("pt-BR", { maximumFractionDigits: 2 })})` : "";
    // Movimentos ligados ate a data do saldo ja estao dentro dele (mostra para nao parecer que sumiram)
    const inside = flows.length - fl.length;
    const incl = inside > 0 ? ` (${inside} ${inside > 1 ? "movimentos anteriores já estão" : "movimento anterior já está"} nesse saldo)` : "";
    if (!f?.cdi.d.length) return { ...r, value: bal + net, cost: bal + net, note: `${fmtP(pct)} do CDI - saldo de ${fmtD(at)}${incl}${moved}`, problem: null };
    const value = bal * cdiFactor(f, dayBR(at), pct) + fl.reduce((s, x) => s + x.v * cdiFactor(f, x.d, pct), 0);
    const year = (1 + cdiDaily(f)! * pct) ** 252 - 1;
    const days = Math.floor((Date.now() - at) / DAY);
    return {
      ...r, value, cost: bal + net, monthly: monthlyOf(value, year), yieldYear: year,
      note: `${(pct * 100).toLocaleString("pt-BR")}% do CDI - saldo de ${fmtD(at)}${incl}${moved} + rendimento estimado`,
      stale: days > 60 ? `saldo informado há ${days} dias: confira no app do banco` : null,
    };
  }
  if (item.kind === "tesouro") {
    const r = { ...base, kindLabel: "Tesouro Direto", group: item.reserva ? "reserva" : "rendafixa" } as FinRow;
    const [name, venc] = (item.title ?? "").split("|");
    const t = f?.tesouro?.titles.find((x) => x.name === name && x.venc === venc);
    const qty = item.qty ?? 0;
    const cost = item.avg ? item.avg * qty : null;
    if (!t) return { ...r, cost, problem: f?.tesouro ? "título não encontrado nos preços do dia" : "preços do Tesouro ainda não carregados" };
    const value = t.pu * qty;
    const cdi = cdiYear(f);
    const ipca = f?.ipca12m ?? null;
    // Estimativa de quanto o titulo rende ao ano: Selic ~ CDI; IPCA+ = taxa + inflacao dos ultimos 12 meses; prefixado = taxa
    const year = /selic/i.test(name) ? (cdi ?? 0) + t.taxa / 100
      : /ipca/i.test(name) ? (ipca === null ? null : (1 + t.taxa / 100) * (1 + ipca) - 1)
      : t.taxa / 100;
    return {
      ...r, value, cost, price: t.pu, yieldYear: year, monthly: year === null ? null : monthlyOf(value, year),
      note: `vence ${venc} - taxa de hoje ${t.taxa.toLocaleString("pt-BR")}%${/selic/i.test(name) ? " + Selic" : /ipca/i.test(name) ? " + IPCA" : " ao ano"} - preço de ${fmtD(Date.parse(`${f!.tesouro!.date}T12:00:00`))}`,
    };
  }
  if (item.kind === "acao") {
    const tk = (item.ticker ?? "").toUpperCase();
    const q = f?.quotes?.[tk];
    const qty = item.qty ?? 0;
    const cost = item.avg ? item.avg * qty : null;
    if (!q) return { ...base, kindLabel: "Ação / FII", group: "acoes", cost, problem: "cotação ainda não carregada (clique em Atualizar cotações)" };
    const d12 = divs12m(q.divs);
    const value = q.price * qty;
    const lastDiv = q.divs[q.divs.length - 1];
    return {
      ...base, kindLabel: q.type === "fii" ? "FII" : q.type === "etf" ? "ETF" : "Ação", group: q.type === "fii" ? "fiis" : "acoes",
      value, cost, price: q.price, change: q.change, yieldYear: d12 > 0 ? d12 / q.price : null, monthly: d12 > 0 ? (d12 * qty) / 12 : null,
      note: d12 > 0
        ? `proventos 12 m: R$ ${d12.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} por cota - último ${fmtD(lastDiv.t)}`
        : "sem proventos nos últimos 12 meses",
    };
  }
  if (item.kind === "bem") {
    // Valor informado numa data, corrigido pela valorizacao/depreciacao anual (se informada)
    const years = item.valueAt ? (Date.now() - item.valueAt) / (365.25 * DAY) : 0;
    const rate = (item.rate ?? 0) / 100;
    const value = (item.value ?? 0) * (1 + rate) ** years;
    const label = { imovel: "Imovel", terreno: "Terreno", veiculo: "Veiculo", outro: "Bem" }[item.bemType ?? "outro"];
    const age = item.valueAt ? Math.floor((Date.now() - item.valueAt) / DAY) : null;
    return {
      ...base, group: "bens", kindLabel: label, value, cost: item.paid ?? null,
      note: `valor estimado em ${item.valueAt ? fmtD(item.valueAt) : "-"}${rate ? ` (${rate > 0 ? "+" : ""}${(rate * 100).toLocaleString("pt-BR")}% ao ano)` : ""}${item.ignore ? " - não conta no patrimônio" : ""}`,
      stale: age !== null && age > 365 && !rate ? `valor de ${age} dias atrás: atualize a estimativa` : null,
    };
  }
  const days = item.valueAt ? Math.floor((Date.now() - item.valueAt) / DAY) : null;
  const fl = flows.filter((x) => !item.valueAt || x.d > dayBR(item.valueAt));
  const net = fl.reduce((s, x) => s + x.v, 0);
  return {
    ...base, kindLabel: "Outro", value: (item.value ?? 0) + net, cost: null,
    note: (item.valueAt ? `valor informado em ${fmtD(item.valueAt)}` : "valor informado") + (fl.length ? ` + ${fl.length} movimentos ligados` : ""),
    stale: days !== null && days > 90 ? `valor informado há ${days} dias: atualize` : null,
  };
}

// Comparacao com o CDI: o que o investimento rendeu desde a data da compra (valor de hoje + proventos recebidos)
// contra o mesmo dinheiro aplicado na mesma data a 100% do CDI. So Tesouro e acoes com data e preco medio
export type CdiCmp = {
  row: FinRow; since: string; days: number; cost: number; now: number; divs: number;
  ret: number; cdiRet: number; cdiValue: number; diff: number;
};
export function compareCdi(rows: FinRow[], f: FinanceDoc | null, today = Date.now()) {
  const list: CdiCmp[] = [];
  const missing: FinRow[] = [];
  const old: FinRow[] = [];
  const first = f?.cdi.d[0] ?? null;
  for (const r of rows) {
    const it = r.item;
    if ((it.kind !== "acao" && it.kind !== "tesouro") || it.ignore || r.value === null) continue;
    if (!it.since || !(r.cost !== null && r.cost > 0)) { missing.push(r); continue; }
    if (!f || !first) continue;
    const since = dayBR(it.since);
    if (since < first) { old.push(r); continue; }
    const fac = cdiFactor(f, since, 1);
    const q = it.kind === "acao" ? f.quotes?.[(it.ticker ?? "").toUpperCase()] : undefined;
    // proventos com data com depois da compra, com a quantidade de hoje
    const divs = (q?.divs ?? []).filter((d) => dayBR(d.t) > since && d.t <= today).reduce((s, d) => s + d.v, 0) * (it.qty ?? 0);
    const now = r.value + divs;
    list.push({
      row: r, since, days: Math.floor((today - it.since) / DAY), cost: r.cost, now, divs,
      ret: now / r.cost - 1, cdiRet: fac - 1, cdiValue: r.cost * fac, diff: now - r.cost * fac,
    });
  }
  return { list, missing, old, first };
}

// Patrimonio total em R$: investimentos + carteiras cripto (dolar -> real pela PTAX)
// cash = saldo em conta (aba Entradas e saidas), entra como o grupo "Conta corrente"
export function financeSummary(items: FinItem[], f: FinanceDoc | null, wallet: WalletDoc | null, monthlyCost?: number, cash?: number | null,
  flows: Record<string, Flow[]> = {}) {
  const rows = items.map((i) => financeRow(i, f, flows[i.id]));
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g.key, 0])) as Record<FinGroup, number>;
  for (const r of rows) if (!r.item.ignore) byGroup[r.group] += r.value ?? 0;
  const usd = f?.usdbrl ?? null;
  if (wallet && usd) {
    const { byClass } = walletTotals(wallet);
    byGroup.dolar += byClass.stable * usd;
    byGroup.cripto += (wallet.total - byClass.stable) * usd;
  }
  if (cash) byGroup.conta += cash;
  const total = Object.values(byGroup).reduce((s, v) => s + v, 0);
  // Lucro/prejuizo: so dos investimentos (bens ficam fora)
  const withCost = rows.filter((r) => r.cost !== null && r.value !== null && r.item.kind !== "bem");
  const cost = withCost.reduce((s, r) => s + r.cost!, 0);
  const gain = withCost.reduce((s, r) => s + r.value! - r.cost!, 0);
  const monthly = rows.reduce((s, r) => s + (r.monthly ?? 0), 0);
  const dividends = rows.filter((r) => r.item.kind === "acao").reduce((s, r) => s + (r.monthly ?? 0), 0);
  const reserve = byGroup.reserva;
  return {
    rows, byGroup, total, usd, cost, gain, monthly, dividends, reserve,
    bens: byGroup.bens, totalNoBens: total - byGroup.bens,
    reserveMonths: monthlyCost && monthlyCost > 0 ? reserve / monthlyCost : null,
    cryptoMissingFx: !!wallet && !usd,
  };
}

// Titulos do Tesouro para o formulario: "tipo|vencimento"
export const tesouroOptions = (f: FinanceDoc | null) =>
  (f?.tesouro?.titles ?? []).map((t) => ({ id: `${t.name}|${t.venc}`, label: `${t.name} ${t.venc.slice(6)}`, sort: brToIso(t.venc) }));
