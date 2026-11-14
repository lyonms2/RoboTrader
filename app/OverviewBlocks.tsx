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
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}R$ ${fmt(Math.abs(v))}`;
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

// ---------- blocos da Visao geral ----------
type Ctx = {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; spend: { value: number; months: number } | null;
  debt: { total: number; loans: number; cards: number; recv: number }; months: Record<string, MonthDoc>; setup: GastosSetup;
};

// Patrimonio: liquido, reserva, rendimento, lucro e onde esta o dinheiro
export function PatrimonioCard({ cfg, fin, wallet, spend, debt, months, setup, onBens }: Ctx & { onBens: () => void }) {
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));
  const notices = s.rows.flatMap((r) => [r.stale, r.problem].filter(Boolean).map((t) => `${r.item.name}: ${t}`));
  const cdi = cdiYear(fin);
  return (
      <section className="card">
        <div className="card-head">
          <h2>Patrimônio</h2>
          <button className="link" onClick={onBens}>ver contas e bens &rsaquo;</button>
        </div>
        <div className="kpis">
          <div><span>{s.bens > 0 ? "Patrimônio sem bens" : debt.total > 0 ? "Patrimônio líquido" : "Patrimônio total"}</span><b>{brl(s.totalNoBens + debt.recv - debt.total)}</b>
            <small className="muted">{debt.total > 0 || debt.recv > 0 ? `${brl(s.totalNoBens, 0)}${debt.recv > 0 ? ` + ${brl(debt.recv, 0)} a receber` : ""}${debt.total > 0 ? ` - ${brl(debt.total, 0)} de dívidas` : ""}` : s.usd && wallet ? `~US$ ${fmt(s.total / s.usd)} - cripto incluída` : wallet ? "falta o dólar: Atualizar cotações em Investimentos" : "sem carteiras cripto"}</small></div>
          {s.bens > 0 && <div><span>Patrimônio com bens</span><b>{brl(s.total + debt.recv - debt.total)}</b>
            <small className="muted">+ {brl(s.bens, 0)} em imóveis, veículos...</small></div>}
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
          {fin?.usdbrl && <span>Dólar R$ {fmt(fin.usdbrl, 4)} (PTAX)</span>}
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

