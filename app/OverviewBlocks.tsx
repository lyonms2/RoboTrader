"use client";
// Blocos da Visao geral (patrimonio, mes e proximos pagamentos, evolucao). Separados da aba Financas para a Visao geral
// abrir sem baixar o codigo das outras abas.
import { deleteField, doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { GROUPS, cdiYear, financeSummary, type FinGroup } from "@/lib/financeMath";
import type { AppConfig, FinanceDoc, WalletDoc } from "@/lib/types";
import { accountBalance, investFlows, monthLabel, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import { netWorth, type NetWorthDoc } from "@/lib/patrimonio";
import { guardWrite, monthSnapshot, upcoming } from "./gastosShared";
import NetWorthChart from "./NetWorthChart";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$\u00a0${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}R$\u00a0${fmt(Math.abs(v))}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const pctS = (v: number, d = 1) => `${fmt(v * 100, d)}%`;

// Barra 100%: patrimonio por grupo (cor fixa por grupo)
export function FinBar({ byGroup }: { byGroup: Record<FinGroup, number> }) {
  const [hover, setHover] = useState<FinGroup | null>(null);
  // Bens ficam fora da barra (aparecem numa linha separada)
  const parts = GROUPS.filter((g) => g.key !== "bens").map((g) => ({ ...g, value: Math.max(0, byGroup[g.key]) })).filter((g) => g.value > 0.005);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return null;
  const W = 640;
  const GAP = 2;
  const usable = W - GAP * (parts.length - 1);
  let x = 0;
  const segs = parts.map((p) => {
    const w = Math.max(2, (p.value / total) * usable);
    const seg = { ...p, x, w, pct: p.value / total };
    x += w + GAP;
    return seg;
  });
  const hov = segs.find((g) => g.key === hover);
  return (
    <figure className="viz">
      <figcaption className="small muted">Onde está o dinheiro {hov ? `- ${hov.label}: ${brl(hov.value)} (${pctS(hov.pct)})` : ""}</figcaption>
      <svg viewBox={`0 0 ${W} 22`} preserveAspectRatio="none" className="alloc" role="img" aria-label="Patrimônio por grupo" onMouseLeave={() => setHover(null)}>
        {segs.map((g) => (
          <rect key={g.key} x={g.x} y={0} width={g.w} height={22} rx={4} className={`g-${g.key}${hover && hover !== g.key ? " dim" : ""}`}
            onMouseEnter={() => setHover(g.key)}>
            <title>{`${g.label}: ${brl(g.value)} (${pctS(g.pct)})`}</title>
          </rect>
        ))}
      </svg>
      <ul className="viz-legend small">
        {segs.map((g) => (
          <li key={g.key} onMouseEnter={() => setHover(g.key)} onMouseLeave={() => setHover(null)}>
            <i className={`g-${g.key}`} />{g.label} <b>{pctS(g.pct)}</b> <span className="muted">{brl(g.value, 0)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// A conta do patrimonio linha a linha: o que tem - o que deve = liquido (cripto so quando informada)
export function BalanceEq({ contas, investido, crypto, bens, recv, cards, loans }: {
  contas: number; investido: number; crypto?: number; bens: number; recv: number; cards: number; loans: number;
}) {
  const liquido = contas + investido + (crypto ?? 0) + bens + recv - cards - loans;
  return (
    <ul className="bal-eq">
      <li><span>Contas</span><b>{brl(contas)}</b></li>
      <li><span>Investimentos</span><b>{brl(investido)}</b></li>
      {crypto !== undefined && <li><span>Cripto</span><b>{brl(crypto)}</b></li>}
      {bens > 0 && <li><span>Bens (imóveis, veículos)</span><b>{brl(bens)}</b></li>}
      {recv > 0 && <li><span>A receber</span><b className="pos">{brl(recv)}</b></li>}
      {cards > 0 && <li className="minus"><span>Cartões (faturas e parcelas)</span><b>-{brl(cards)}</b></li>}
      {loans > 0 && <li className="minus"><span>Empréstimos</span><b>-{brl(loans)}</b></li>}
      <li className="total"><span>Líquido</span><b className={liquido < 0 ? "neg" : "pos"}>{brl(liquido)}</b></li>
    </ul>
  );
}

// ---------- blocos da Visao geral ----------
type Ctx = {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; spend: { value: number; months: number } | null;
  debt: { total: number; loans: number; cards: number; recv: number }; months: Record<string, MonthDoc>; setup: GastosSetup;
};

// Patrimonio: liquido, reserva, rendimento, lucro e onde esta o dinheiro
export function PatrimonioCard({ cfg, fin, wallet, spend, debt, months, setup, onBens, nwHist = [], start = null, children }: Ctx & {
  onBens: () => void; nwHist?: NetWorthDoc[]; start?: string | null; children?: React.ReactNode;
}) {
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));
  const notices = s.rows.flatMap((r) => [r.stale, r.problem].filter(Boolean).map((t) => `${r.item.name}: ${t}`));
  const cdi = cdiYear(fin);
  // Bruto = tudo o que voce tem (contas, investimentos, cripto, bens e o que te devem), antes das dividas
  const bruto = s.total + debt.recv;
  const liquido = bruto - debt.total;
  // quanto o bruto mudou em ~30 dias (pelas fotos do dia; respeita o comeco escolhido no grafico)
  const hist = nwHist.filter((h) => !start || h.day >= start);
  const ref = [...hist].reverse().find((h) => h.t <= Date.now() - 30 * 86_400_000) ?? hist[0];
  const chg = ref && ref.day !== hist[hist.length - 1]?.day ? bruto - ref.bens : null;
  return (
      <section className="card">
        <div className="card-head">
          <h2>Patrimônio</h2>
          <button className="link" onClick={onBens}>ver contas e bens &rsaquo;</button>
        </div>
        <div className="hero">
          <div className="hero-main">
            <span>Patrimônio bruto</span>
            <b>{brl(bruto)}</b>
            <small>tudo o que você tem{s.usd && wallet ? `, ~US$ ${fmt(bruto / s.usd, 0)}` : ""}</small>
            {chg !== null && Math.abs(chg) >= 1 && <em className={chg >= 0 ? "hero-chip up" : "hero-chip down"}>{chg >= 0 ? "+" : "-"}{brl(Math.abs(chg), 0)} desde {new Date(ref!.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</em>}
          </div>
          <div className="hero-side">
            <div><span>{debt.total > 0 ? "Líquido (depois das dívidas)" : "Líquido"}</span><b className={liquido < 0 ? "neg" : ""}>{brl(liquido)}</b>
              <small className="muted">{debt.total > 0 ? `${brl(debt.total, 0)} de dívidas` : "sem dívidas"}{debt.recv > 0 ? ` - inclui ${brl(debt.recv, 0)} a receber` : ""}</small></div>
            {s.bens > 0 && <div><span>Sem bens</span><b>{brl(liquido - s.bens)}</b><small className="muted">{brl(s.bens, 0)} em imóveis, veículos...</small></div>}
            {wallet && !s.usd && <small className="warn">falta o dólar: Atualizar cotações em Investimentos</small>}
          </div>
        </div>
        <details className="eq-more">
          <summary>ver a conta: o que você tem - o que deve</summary>
          <BalanceEq contas={s.byGroup.conta} investido={s.total - s.byGroup.cripto - s.byGroup.dolar - s.byGroup.conta - s.bens}
            crypto={s.byGroup.cripto + s.byGroup.dolar} bens={s.bens} recv={debt.recv} cards={debt.cards} loans={debt.loans} />
        </details>
        <div className="kpis">
          <div><span>Reserva de emergência</span><b>{brl(s.reserve)}</b>
            <small className="muted">{s.reserveMonths !== null ? `cobre ${fmt(s.reserveMonths, 1)} meses de gastos` : "a média de gastos aparece depois do 1o mês completo de lançamentos"}{spend ? ` (média de ${spend.months} ${spend.months > 1 ? "meses" : "mês"})` : ""}</small></div>
          <div><span>Rende por mês (estimado)</span><b>{brl(s.monthly)}</b>
            <small className="muted">{s.dividends > 0 ? `${brl(s.dividends)} de proventos` : "juros + proventos, antes de IR"}</small></div>
          <div><span>Lucro / prejuízo</span><b className={pnlClass(s.gain)}>{s.cost > 0 ? signed(s.gain) : "-"}</b>
            <small className="muted">{s.cost > 0 ? `${pctS(s.gain / s.cost)} sobre ${brl(s.cost)} (fora cripto)` : "informe preços médios"}</small></div>
        </div>
        <p className="muted small indic">
          {cdi !== null && <span>CDI {pctS(cdi, 2)} ao ano</span>}
          {fin?.ipca12m != null && <span>IPCA 12 m {pctS(fin.ipca12m, 2)} ({fin.ipcaRef})</span>}
          {fin?.usdbrl && <span>Dólar R${" "}{fmt(fin.usdbrl, 4)} (PTAX)</span>}
          {spend && <span>Gasto médio {brl(spend.value, 0)}/mês</span>}
          {fin && <span>dados de {new Date(fin.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
        </p>
        <FinBar byGroup={s.byGroup} />
        {s.bens > 0 && <p className="small muted">Fora da barra: bens {brl(s.bens, 0)} ({s.rows.filter((r) => r.item.kind === "bem" && !r.item.ignore).map((r) => r.item.name).join(", ")}).</p>}
        {(notices.length > 0 || (fin?.errors.length ?? 0) > 0) && (
          <ul className="alerts small">
            {notices.map((n) => <li key={n} className="warn">{n}</li>)}
            {fin?.errors.map((e) => <li key={e} className="error">Fonte de dados: {e}</li>)}
          </ul>
        )}
        {children}
      </section>
  );
}

// O mes (entrou/saiu/sobrou/em conta) + proximos pagamentos em 30 dias
export function MonthAndUpcoming({ months, setup, onLanc, onBens }: { months: Record<string, MonthDoc>; setup: GastosSetup; onLanc: () => void; onBens: () => void }) {
  const mon = monthSnapshot(months, setup);
  const acct = accountBalance(months, setup);
  const next = upcoming(months, setup);
  return (
      <div className="two-col">
        <section className="card link-card" role="button" tabIndex={0} onClick={onLanc}>
          <div className="card-head"><h2>{monthLabel(mon.m, true)}</h2><span className="muted small">ver lançamentos &rsaquo;</span></div>
          {mon.count || mon.pendingN ? (
            <div className="kpis compact">
              <div><span>Entrou</span><b>{brl(mon.receitas, 0)}</b></div>
              <div><span>Saiu (gastos)</span><b>{brl(mon.gastos, 0)}</b><small className="muted">{mon.avg ? `média ${brl(mon.avg.value, 0)}` : ""}</small></div>
              <div><span>Sobrou</span><b className={mon.receitas - mon.gastos >= 0 ? "pos" : "neg"}>{brl(mon.receitas - mon.gastos, 0)}</b></div>
              <div><span>Em conta</span><b className={acct && acct.value < 0 ? "neg" : ""}>{acct ? brl(acct.value, 0) : "-"}</b>
                <small className={acct && !acct.informed ? "warn" : "muted"}>{acct ? (acct.informed ? "saldo das contas" : "confira o saldo") : ""}</small></div>
            </div>
          ) : <p className="muted small">Nada lançado neste mês. Em Lançamentos, importe o extrato do banco ou lance à mão.</p>}
        </section>
        <section className="card">
          <div className="card-head"><h2>Próximos pagamentos</h2><button className="link" onClick={onBens}>30 dias &rsaquo;</button></div>
          {next.length ? (
            <ul className="pend small">
              {next.slice(0, 7).map((p, i) => (
                <li key={i}><span className={p.late ? "warn" : "muted"}>{dm(p.d)}</span> <b>{p.desc}</b> <span className={p.late ? "warn" : ""}>{brl(p.v)}</span></li>
              ))}
              {next.length > 7 && <li className="muted">+ {next.length - 7}</li>}
            </ul>
          ) : <p className="muted small">Nada a pagar nos próximos 30 dias (cartões e empréstimos se cadastram em Cartões e empréstimos; fixos em Lançamentos).</p>}
        </section>
      </div>
  );
}

export function NetWorthBlock({ cfg, fin, wallet, months, setup, nwHist }: Ctx & { nwHist: NetWorthDoc[] }) {
  // comeco do grafico: guardado na configuracao (os dias anteriores nao sao apagados)
  const onStart = async (d: string | null) => {
    guardWrite();
    await setDoc(doc(db(), P("config/main")), { nwStart: d ?? deleteField() }, { merge: true });
  };
  return <NetWorthChart hist={nwHist} live={netWorth(cfg, fin, wallet, months, setup)} start={cfg.nwStart ?? null} onStart={onStart} />;
}

