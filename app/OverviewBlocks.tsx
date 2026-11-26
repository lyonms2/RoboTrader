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
import { useShowCrypto } from "./cryptoPref";
import { ChevronRight } from "lucide-react";
import { Badge, Button, Card, InfoTip, Money, Section, Stat, Stats } from "./ui";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$\u00a0${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
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
            <i className={`g-${g.key}`} />{g.label} <b>{pctS(g.pct)}</b> <span className="muted">{brl(g.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// A conta do patrimonio linha a linha: o que tem - o que deve = liquido (cripto so quando informada)
export function BalanceEq({ contas, investido, crypto, bens, recv, cards, loans, people = 0 }: {
  contas: number; investido: number; crypto?: number; bens: number; recv: number; cards: number; loans: number;
  people?: number; // conta com a pessoa em que voce deve a ela (ex.: ela te pagou um pouco a mais)
}) {
  const liquido = contas + investido + (crypto ?? 0) + bens + recv - cards - loans - people;
  return (
    <ul className="bal-eq">
      <li><span>Contas</span><b>{brl(contas)}</b></li>
      <li><span>Investimentos</span><b>{brl(investido)}</b></li>
      {crypto !== undefined && <li><span>Cripto</span><b>{brl(crypto)}</b></li>}
      {bens > 0 && <li><span>Bens (imóveis, veículos)</span><b>{brl(bens)}</b></li>}
      {recv > 0 && <li><span>A receber</span><b className="pos">{brl(recv)}</b></li>}
      {cards > 0 && <li className="minus"><span>Cartões (faturas e parcelas)</span><b>-{brl(cards)}</b></li>}
      {loans > 0 && <li className="minus"><span>Empréstimos</span><b>-{brl(loans)}</b></li>}
      {people > 0.004 && <li className="minus"><span>Você deve a pessoas (A receber)</span><b>-{brl(people)}</b></li>}
      <li className="total"><span>Líquido</span><b className={liquido < 0 ? "neg" : "pos"}>{brl(liquido)}</b></li>
    </ul>
  );
}

// ---------- blocos do Inicio (redesign etapa 3, amostra aprovada em 24/11/2026) ----------
export type Ctx = {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; spend: { value: number; months: number } | null;
  debt: { total: number; loans: number; cards: number; recv: number; people?: number }; months: Record<string, MonthDoc>; setup: GastosSetup;
};

// Topo do Inicio: patrimonio liquido em destaque (a conta fica no "i") e os numeros do mes em carrossel
export function HomeHero({ cfg, fin, wallet, spend, debt, months, setup, nwHist = [], start = null, onPat, onMes }: Ctx & {
  nwHist?: NetWorthDoc[]; start?: string | null; onPat: () => void; onMes: () => void;
}) {
  const showCrypto = useShowCrypto();
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));
  const mon = monthSnapshot(months, setup);
  const cdi = cdiYear(fin);
  // Bruto = tudo o que voce tem (contas, investimentos, cripto, bens e o que te devem), antes das dividas
  const bruto = s.total + debt.recv;
  const liquido = bruto - debt.total;
  // quanto o liquido mudou em ~30 dias (pelas fotos do dia; respeita o comeco escolhido no grafico)
  const hist = nwHist.filter((h) => !start || h.day >= start);
  const ref = [...hist].reverse().find((h) => h.t <= Date.now() - 30 * 86_400_000) ?? hist[0];
  const chg = ref && ref.day !== hist[hist.length - 1]?.day ? liquido - ref.net : null;
  const sobrou = mon.receitas - mon.gastos;
  const hasMonth = mon.count > 0;
  const indic = [
    cdi !== null && `CDI ${pctS(cdi, 2)} ao ano`,
    fin?.ipca12m != null && `IPCA 12 m ${pctS(fin.ipca12m, 2)} (${fin.ipcaRef})`,
    fin?.usdbrl && `dólar R$ ${fmt(fin.usdbrl, 4)} (PTAX)`,
  ].filter(Boolean) as string[];
  return (
    <>
      <Card tone="brand" as="section" className="home-hero">
        <div className="home-hero-head">
          <span>Patrimônio líquido</span>
          <InfoTip label="Como é calculado">
            <b>O que você tem − o que deve</b>
            <BalanceEq contas={s.byGroup.conta} investido={s.total - s.byGroup.cripto - s.byGroup.dolar - s.byGroup.conta - s.bens}
              crypto={showCrypto ? s.byGroup.cripto + s.byGroup.dolar : undefined} bens={s.bens} recv={debt.recv} cards={debt.cards} loans={debt.loans} people={debt.people ?? debt.total - debt.cards - debt.loans} />
            {s.bens > 0 && <span className="home-tip-line">Sem os bens: {brl(liquido - s.bens)}</span>}
            {s.usd && wallet ? <span className="home-tip-line">~US$ {fmt(bruto / s.usd, 0)} no total</span> : null}
            {indic.length > 0 && <span className="home-tip-line">{indic.join(" · ")}</span>}
          </InfoTip>
          <Button variant="link" size="sm" className="home-hero-more" onClick={onPat}>ver patrimônio <ChevronRight size={14} aria-hidden="true" /></Button>
        </div>
        <div className="home-hero-value"><Money value={liquido} size="xl" tone={liquido < 0 ? "neg" : undefined} /></div>
        <div className="home-hero-foot">
          {chg !== null && Math.abs(chg) >= 1 && (
            <Badge tone={chg >= 0 ? "pos" : "neg"}>{chg >= 0 ? "▲" : "▼"} {brl(Math.abs(chg))} desde {new Date(ref!.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</Badge>
          )}
          <span>tem {brl(bruto)} · {debt.total > 0 ? `deve ${brl(debt.total)}` : "sem dívidas"}</span>
        </div>
        {wallet && !s.usd && <p className="home-hero-warn">Falta o dólar: Atualizar cotações em Patrimônio &gt; Investimentos.</p>}
      </Card>

      <Stats scroll cols={s.cost > 0 ? 5 : 4}>
        <Stat label="Reserva" value={<Money value={s.reserve} size="md" />}
          hint={s.reserveMonths !== null ? `${fmt(s.reserveMonths, 1)} meses` : "média após o 1º mês"} />
        <button type="button" className="home-stat-btn" onClick={onMes} aria-label={`${monthLabel(mon.m, true)}: ver o mês`}>
          <Stat label="Sobrou no mês" value={hasMonth ? <Money value={sobrou} size="md" tone="auto" /> : "-"}
            hint={hasMonth ? `de ${brl(mon.receitas)}` : "nada lançado"} />
        </button>
        <Stat label="Em conta" value={acct ? <Money value={acct.value} size="md" tone={acct.value < 0 ? "neg" : undefined} /> : "-"}
          hint={acct ? (acct.informed ? "saldo das contas" : <span className="warn">confira o saldo</span>) : "cadastre as contas"} />
        <Stat label="Rende por mês" value={<Money value={s.monthly} size="md" />}
          hint={s.dividends > 0 ? `${brl(s.dividends)} de proventos` : "estimado"} />
        {s.cost > 0 && <Stat label="Lucro / prejuízo" value={<Money value={s.gain} size="md" tone="auto" signed />}
          hint={`${pctS(s.gain / s.cost)} fora cripto`} />}
      </Stats>
    </>
  );
}

// Proximos pagamentos em 30 dias: cartoezinhos que deslizam no celular
export function NextPayments({ months, setup, onMes }: { months: Record<string, MonthDoc>; setup: GastosSetup; onMes: () => void }) {
  const next = upcoming(months, setup);
  const late = next.filter((p) => p.late).length;
  return (
    <Section title="Próximos pagamentos" count={late || undefined}
      action={<Button variant="link" size="sm" onClick={onMes}>30 dias <ChevronRight size={14} aria-hidden="true" /></Button>}>
      {next.length ? (
        <div className="home-pay">
          {next.slice(0, 6).map((p, i) => (
            <div key={i} className={p.late ? "home-pay-item late" : "home-pay-item"}>
              <span className="home-pay-when">{p.late ? `venceu ${dm(p.d)}` : dm(p.d)} · {p.desc}</span>
              <Money value={p.v} size="md" tone={p.late ? "warn" : undefined} />
            </div>
          ))}
          {next.length > 6 && <button type="button" className="home-pay-item more" onClick={onMes}>+ {next.length - 6} no mês</button>}
        </div>
      ) : <p className="home-empty">Nada a pagar nos próximos 30 dias.</p>}
    </Section>
  );
}

// Onde esta o dinheiro: barra por grupo, avisos das fontes e data dos dados
export function MoneyMix({ cfg, fin, wallet, spend, months, setup }: Ctx) {
  const s = financeSummary(cfg.finance ?? [], fin, wallet, spend?.value ?? cfg.monthlyCost, accountBalance(months, setup)?.value, investFlows(months));
  const notices = s.rows.flatMap((r) => [r.stale, r.problem].filter(Boolean).map((t) => `${r.item.name}: ${t}`));
  if (!(s.total > 0) && !notices.length && !fin?.errors.length) return null;
  return (
    <Section title="Onde está o dinheiro">
      <Card>
        <FinBar byGroup={s.byGroup} />
        {s.bens > 0 && <p className="home-note">Fora da barra: bens {brl(s.bens)}.</p>}
        {(notices.length > 0 || (fin?.errors.length ?? 0) > 0) && (
          <ul className="alerts small">
            {notices.map((n) => <li key={n} className="warn">{n}</li>)}
            {fin?.errors.map((e) => <li key={e} className="error">Fonte de dados: {e}</li>)}
          </ul>
        )}
        {fin && <p className="home-note">Cotações de {new Date(fin.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{spend ? ` · gasto médio ${brl(spend.value)}/mês` : ""}</p>}
      </Card>
    </Section>
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

