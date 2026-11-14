import {
  CARD_PAY_CAT, GENERIC_CATS, accIdOf, accountsOf, accountsStatus, budgetSpent, addMonths, cardStatus, catLabel, faturaMonth, fixoHistory, monthBills, monthOf, recvLedger, subValue, summarize, todayBR,
  type Card, type GastosSetup, type MonthDoc,
} from "./gastos";

// Avisos da Visao geral: so fatos da conta da pessoa (financas). Nunca "compre" ou "venda".
export type SmartAlert = { id: string; prio: 1 | 2 | 3; tone: "warn" | "info"; who: string; text: string; fin: "lanc" | "cards" | "bens" | "invest" | "recv" };
type Upcoming = { d: string; desc: string; v: number; late: boolean };

const num = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$\u00a0${num(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dayMs = 86_400_000;
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / dayMs);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

// Melhor dia para comprar: o primeiro dia em que a compra ja cai na fatura seguinte (mais prazo para pagar)
export function bestBuy(c: Card, today = todayBR()) {
  for (let i = 0; i < 40; i++) {
    const d = plusDays(today, i);
    if (faturaMonth(c, d) > faturaMonth(c, plusDays(d, -1))) {
      const fm = faturaMonth(c, d);
      const due = `${fm}-${String(Math.min(c.dueDay, new Date(Date.UTC(Number(fm.slice(0, 4)), Number(fm.slice(5, 7)), 0)).getUTCDate())).padStart(2, "0")}`;
      return { d, day: Number(d.slice(8, 10)), fm, due, prazo: diffDays(due, d), inDays: i };
    }
  }
  return null;
}

// Saldo conferido neste mes e inicio do mes negativo: o site calcula de tras para frente, entao em geral faltam saidas lancadas
export function negativeStarts(months: Record<string, MonthDoc>, setup: GastosSetup, m = monthOf(todayBR())) {
  return accountsStatus(months, setup, m).rows.filter((r) => !r.acc.noStatement && r.acc.balance !== undefined && !!r.acc.at && r.acc.at.slice(0, 7) === m && r.start < -0.5)
    .map((r) => ({ id: r.acc.id, name: r.acc.name, start: r.start }));
}

export function buildAlerts(a: {
  months: Record<string, MonthDoc>; setup: GastosSetup; up: Upcoming[]; saldo: number | null; avg: { value: number } | null;
  reserve: number; reserveMonths: number | null; hist: { t: number; byGroup: { reserva?: number } }[]; today?: string;
}): SmartAlert[] {
  const { months, setup, up, saldo, avg, reserve, reserveMonths, hist } = a;
  const today = a.today ?? todayBR();
  const m = monthOf(today);
  const items = months[m]?.items ?? [];
  const day = Number(today.slice(8, 10));
  const lastDay = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const out: SmartAlert[] = [];

  // 1) saldo x o que vence em 15 dias (inclui o que ja venceu)
  const limit = plusDays(today, 15);
  const next = up.filter((p) => p.d <= limit);
  const dueSum = next.reduce((t, p) => t + p.v, 0);
  if (saldo !== null && dueSum > saldo + 0.5)
    out.push({ id: `saldo:${m}`, prio: 1, tone: "warn", who: "Saldo", text: `Vencem ${brl(dueSum)} em até 15 dias e as contas têm ${brl(saldo)}: faltam ${brl(dueSum - saldo)}`, fin: "lanc" });

  // 2) vence em ate 3 dias
  for (const p of up.filter((x) => !x.late && diffDays(x.d, today) >= 0 && diffDays(x.d, today) <= 3)) {
    const n = diffDays(p.d, today);
    out.push({ id: `soon:${p.desc}:${p.d}`, prio: 1, tone: "warn", who: "Vence", text: `${p.desc} vence ${n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias (${dm(p.d)})`}: ${brl(p.v)}`, fin: /^Fatura /.test(p.desc) ? "cards" : "lanc" });
  }

  // 3) limite, fatura maior que a anterior e melhor dia de comprar
  for (const c of setup.cards) {
    const st = cardStatus(c, months, today);
    if (c.limit && st.open / c.limit >= 0.8)
      out.push({ id: `limit:${c.id}`, prio: 2, tone: "warn", who: "Cartão", text: `${c.name} com ${num((st.open / c.limit) * 100, 0)}% do limite usado (${brl(st.open, 0)} de ${brl(c.limit, 0)})`, fin: "cards" });
    const f = st.next;
    const prev = f ? st.all.find((x) => x.m === addMonths(f.m, -1)) : null;
    if (f && prev && prev.v >= 100 && f.v >= prev.v * 1.3 && f.v - prev.v >= 50)
      out.push({ id: `fatura:${c.id}:${f.m}`, prio: 2, tone: "info", who: "Cartão", text: `A próxima fatura do ${c.name} está ${num((f.v / prev.v - 1) * 100, 0)}% acima da anterior (${brl(f.v)} contra ${brl(prev.v)})`, fin: "cards" });
    const b = bestBuy(c, today);
    if (b && b.inDays <= 1)
      out.push({ id: `best:${c.id}:${b.d}`, prio: 3, tone: "info", who: "Cartão", text: `${b.inDays === 0 ? "Hoje" : "Amanhã"} é o melhor dia para comprar no ${c.name}: a compra entra na fatura que vence em ${dm(b.due)} (${b.prazo} dias de prazo)`, fin: "cards" });
  }

  // 4) ritmo do mes contra a media
  const s = summarize(items, { m, months });
  if (avg && avg.value > 0 && day >= 3) {
    const pct = s.gastos / avg.value, elapsed = day / lastDay;
    if (pct >= elapsed + 0.3 && pct < 3)
      out.push({ id: `ritmo:${m}`, prio: 2, tone: "warn", who: "Gastos", text: `Dia ${day} e você já gastou ${num(pct * 100, 0)}% da sua média mensal (${brl(s.gastos, 0)} de ${brl(avg.value, 0)})`, fin: "lanc" });
  }

  // 5) dados desatualizados
  const accounts = accountsOf(setup);
  for (const acc of accounts.filter((x) => !x.noStatement)) {
    let last = "";
    for (const md of Object.values(months)) for (const g of md.items) if (g.ext && accIdOf(g, accounts) === acc.id && g.d > last) last = g.d;
    const dl = last ? diffDays(today, last) : 0;
    const dc = acc.at ? diffDays(today, acc.at) : 0;
    if (dl >= 10) out.push({ id: `extrato:${acc.id}:${m}`, prio: 3, tone: "info", who: "Dados", text: `Último extrato da conta ${acc.name} tem ${dl} dias: importe o novo para os números ficarem certos`, fin: "lanc" });
    else if (dc >= 30) out.push({ id: `saldo-conf:${acc.id}:${m}`, prio: 3, tone: "info", who: "Dados", text: `O saldo da conta ${acc.name} não é conferido há ${dc} dias`, fin: "bens" });
  }

  for (const r of negativeStarts(months, setup, m))
    out.push({ id: `inicio-neg:${r.id}:${m}`, prio: 2, tone: "warn", who: "Dados", text: `O início do mês da conta ${r.name} aparece negativo (${brl(r.start)}): se a conta não estava no vermelho, faltam saídas lançadas. Importe o extrato do mês`, fin: "lanc" });

  // orcamento por categoria: passou do limite ou chegou em 80%
  const spentCat = budgetSpent(months, setup, m);
  for (const [c, lim] of Object.entries(setup.budgets ?? {})) {
    const v = spentCat[c] ?? 0;
    if (!(lim > 0)) continue;
    if (v > lim + 0.005) out.push({ id: `orc-over:${c}:${m}`, prio: 1, tone: "warn", who: "Orçamento", text: `${catLabel(c)} passou do orçamento do mês: ${brl(v)} de ${brl(lim)} (${brl(v - lim)} a mais)`, fin: "lanc" });
    else if (v >= lim * 0.8) out.push({ id: `orc-80:${c}:${m}`, prio: 2, tone: "info", who: "Orçamento", text: `${catLabel(c)} já usou ${num((v / lim) * 100, 0)}% do orçamento do mês (${brl(v)} de ${brl(lim)})`, fin: "lanc" });
  }

  // 6) categoria fora do padrao (a que mais passou da media)
  const keys = [1, 2, 3].map((k) => addMonths(m, -k)).filter((k) => months[k]?.items.length);
  if (keys.length >= 2) {
    // media so dos meses em que a categoria apareceu, e com pelo menos 2 meses (senao o comeco do historico vira alarme falso)
    const seen: Record<string, number[]> = {};
    for (const k of keys) for (const [c, v] of Object.entries(summarize(months[k].items, { m: k, months }).byCat)) if (v > 0) (seen[c] ??= []).push(v);
    const mean: Record<string, number> = {};
    for (const [c, l] of Object.entries(seen)) if (l.length >= 2) mean[c] = l.reduce((t, v) => t + v, 0) / l.length;
    const over = Object.entries(s.byCat).filter(([c, v]) => c !== CARD_PAY_CAT && c !== "Emprestimos" && !GENERIC_CATS.includes(c) && (mean[c] ?? 0) >= 100 && v >= mean[c] * 1.6 && v - mean[c] >= 50)
      .sort((x, y) => (y[1] - mean[y[0]]) - (x[1] - mean[x[0]]))[0];
    if (over) out.push({ id: `cat:${over[0]}:${m}`, prio: 2, tone: "info", who: "Gastos", text: `${catLabel(over[0])} está ${num((over[1] / mean[over[0]] - 1) * 100, 0)}% acima da média dos meses anteriores (${brl(over[1], 0)} contra ${brl(mean[over[0]], 0)})`, fin: "lanc" });
  }

  // 7) conta fixa mais cara que o normal
  for (const b of monthBills(m, items, setup, months).filter((x) => x.fixo && x.paid)) {
    const f = setup.fixos.find((x) => x.id === b.ref);
    const h = f ? fixoHistory(f, m, months) : [];
    if (h.length < 2) continue;
    const media = h.reduce((t, x) => t + x.v, 0) / h.length;
    if (b.paid!.v >= media * 1.25 && b.paid!.v - media >= 10)
      out.push({ id: `fixo:${b.ref}:${m}`, prio: 2, tone: "info", who: "Fixo", text: `${b.desc} veio ${num((b.paid!.v / media - 1) * 100, 0)}% acima da média (${brl(b.paid!.v)} contra ${brl(media)})`, fin: "lanc" });
  }

  // 8) assinaturas: total a cada 3 meses e aumento recente
  const active = setup.cards.flatMap((c) => (c.subs ?? []).filter((x) => x.start <= m && (!x.end || x.end >= m)));
  if (active.length && (Number(m.slice(5, 7)) - 1) % 3 === 0)
    out.push({ id: `subs:${m}`, prio: 3, tone: "info", who: "Assinaturas", text: `Você paga ${brl(active.reduce((t, x) => t + subValue(x, m), 0))} por mês em ${active.length} ${active.length > 1 ? "assinaturas" : "assinatura"}: ainda usa todas?`, fin: "cards" });
  for (const x of active)
    for (const st of x.steps ?? [])
      if (st.from === m || st.from === addMonths(m, -1)) {
        const antes = subValue(x, addMonths(st.from, -1));
        if (st.v > antes + 0.005) out.push({ id: `sub-up:${x.id}:${st.from}`, prio: 2, tone: "info", who: "Assinaturas", text: `${x.desc} ficou mais cara: de ${brl(antes)} para ${brl(st.v)}`, fin: "cards" });
      }

  // 9) pessoa sem movimento no mes (depois do dia 20)
  if (day >= 20)
    for (const r of (setup.recvs ?? []).filter((x) => x.kind === "conta" && (x.since ?? "").slice(0, 7) !== m)) {
      const led = recvLedger(r, months);
      const saldoP = led.length ? led[led.length - 1].bal : 0;
      if (saldoP > 0.5 && !led.some((e) => e.kind !== "inicio" && e.d.slice(0, 7) === m))
        out.push({ id: `pessoa:${r.id}:${m}`, prio: 3, tone: "info", who: "Receber", text: `${r.name} não teve movimento este mês; saldo ${brl(saldoP)}`, fin: "recv" });
    }

  // 10) reserva caindo (contra cerca de 30 dias atras)
  const cut = Date.now() - 30 * dayMs;
  const past = [...hist].filter((x) => x.t <= cut).sort((x, y) => y.t - x.t)[0];
  const antes = past?.byGroup.reserva ?? 0;
  if (antes > 0 && reserve < antes * 0.9)
    out.push({ id: `reserva:${m}`, prio: 2, tone: "warn", who: "Reserva", text: `Sua reserva caiu de ${brl(antes, 0)} para ${brl(reserve, 0)} em 30 dias${reserveMonths !== null ? `; cobre ${num(reserveMonths, 1)} meses de gastos` : ""}`, fin: "invest" });

  return out;
}
