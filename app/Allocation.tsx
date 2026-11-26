"use client";
// Alocacao alvo: o membro define as % de cada classe (o site nao sugere numeros); mostra onde ele esta, quanto falta em cada
// classe e para onde vai o proximo aporte (reserva primeiro, depois as classes abaixo do alvo). So organiza: nada e recomendacao.
import { useEffect, useState } from "react";
import { PiggyBank, Target } from "lucide-react";
import { ALLOC_GROUPS, GROUPS, planAporte, type FinGroup } from "@/lib/financeMath";
import { Badge, Button, Card, Progress, Section, Sheet } from "./ui";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `R$ ${fmt(v)}`;
const pctS = (v: number) => `${fmt(v * 100, v * 100 % 1 ? 1 : 0)}%`;
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
const label = (g: FinGroup) => GROUPS.find((x) => x.key === g)?.label ?? g;

export type TargetCfg = { pct: Record<string, number>; reserveMonths?: number };

// Rosca dupla: anel de fora = alvo; de dentro = carteira hoje (ou depois do aporte)
function Donut({ groups, outer, inner, center, sub }: { groups: FinGroup[]; outer: Record<string, number>; inner: Record<string, number>; center: string; sub: string }) {
  const ring = (vals: Record<string, number>, r: number, w: number, key: string) => {
    const tot = groups.reduce((s, g) => s + Math.max(0, vals[g] ?? 0), 0);
    const C = 2 * Math.PI * r;
    let off = 0;
    if (!(tot > 0)) return <circle key={key} cx="90" cy="90" r={r} fill="none" stroke="var(--line)" strokeWidth={w} />;
    return groups.filter((g) => (vals[g] ?? 0) > 0).map((g) => {
      const len = (Math.max(0, vals[g]) / tot) * C;
      const el = <circle key={key + g} cx="90" cy="90" r={r} fill="none" stroke={`var(--g-${g})`} strokeWidth={w}
        strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 90 90)" />;
      off += len;
      return el;
    });
  };
  return (
    <svg className="alloc-donut" viewBox="0 0 180 180" role="img" aria-label="Alocação: anel de fora é o alvo, anel de dentro é a carteira">
      {ring(outer, 78, 12, "o")}
      {ring(inner, 60, 16, "i")}
      <text x="90" y="86" textAnchor="middle" className="alloc-donut-v">{center}</text>
      <text x="90" y="104" textAnchor="middle" className="alloc-donut-s">{sub}</text>
    </svg>
  );
}

export default function Allocation({ byGroup, reserve, monthlySpend, target: saved, showCrypto, onSave }: {
  byGroup: Record<string, number>; reserve: number; monthlySpend: number | null; target: TargetCfg | undefined; showCrypto: boolean;
  onSave: (t: TargetCfg) => Promise<void>;
}) {
  // o alvo salvo aparece na hora (o banco confirma depois; sem internet, o Firebase envia quando voltar)
  const [target, setTarget] = useState(saved);
  useEffect(() => { setTarget(saved); }, [saved]);
  const groups = ALLOC_GROUPS.filter((g) => showCrypto || (g !== "cripto" && g !== "dolar"));
  const [editing, setEditing] = useState(false);
  const [aporte, setAporte] = useState("");
  const cur = Object.fromEntries(groups.map((g) => [g, Math.max(0, byGroup[g] ?? 0)]));
  const total = groups.reduce((s, g) => s + cur[g], 0);
  const pct = target?.pct ?? {};
  const has = groups.some((g) => (pct[g] ?? 0) > 0);
  const months = target?.reserveMonths ?? 6;
  const goal = monthlySpend && monthlySpend > 0 ? months * monthlySpend : null;
  const a = num(aporte);
  const plan = has && a > 0 ? planAporte(cur, pct, { have: reserve, goal }, a, groups) : null;
  const inner = plan ? plan.after : cur;
  const base = plan ? plan.total : total;
  const shown = groups.filter((g) => (pct[g] ?? 0) > 0 || cur[g] > 0);

  return (
    <Section id="alocacao" title="Alocação alvo"
      info={<>Você escolhe quanto quer em cada classe (as % somam 100). O site mostra onde a carteira está, quanto falta em cada classe e para onde
        vai o próximo aporte: primeiro a reserva, depois as classes abaixo do alvo, sem vender nada. É organização da sua própria divisão, não recomendação de investimento.</>}
      action={has && <Button variant="link" size="sm" icon={<Target size={14} aria-hidden="true" />} onClick={() => setEditing(true)}>alterar alvo</Button>}>
      {!has ? (
        <Card className="alloc-empty">
          <span className="alloc-empty-ico" aria-hidden="true"><Target size={26} /></span>
          <div><b>Monte a sua alocação</b>
            <p>Divida o que você investe em classes (renda fixa, ações, FIIs...) com as % que fazem sentido para você. O site mostra onde você está e para onde vai o próximo aporte.</p></div>
          <Button variant="primary" onClick={() => setEditing(true)}>Definir alvo</Button>
        </Card>
      ) : (
        <Card className="alloc-card">
          {/* reserva primeiro, fora das % */}
          <div className="alloc-res">
            <div className="alloc-res-top"><span><PiggyBank size={16} aria-hidden="true" /> Reserva de emergência</span>
              <b>{goal !== null ? `${brl(reserve)} de ${brl(goal)}` : brl(reserve)}</b></div>
            {goal !== null ? <>
              <Progress value={goal > 0 ? reserve / goal : 0} tone={reserve >= goal ? "pos" : "accent"} label="Reserva em relação à meta" />
              <small>{monthlySpend ? `${fmt(reserve / monthlySpend, 1)} de ${fmt(months, months % 1 ? 1 : 0)} meses de gasto` : ""}{reserve >= goal ? " · completa: os aportes vão para as classes" : " · os aportes completam a reserva primeiro"}</small>
            </> : <small>A meta em meses aparece depois do 1º mês de lançamentos (precisa da média de gastos).</small>}
          </div>

          <div className="alloc-main">
            <div className="alloc-chart">
              <Donut groups={groups} outer={pct} inner={inner} center={brl(base).replace(/,\d{2}$/, "")} sub={plan ? "depois do aporte" : "investido"} />
              <div className="alloc-key"><span><i className="ring out" />alvo</span><span><i className="ring in" />{plan ? "depois do aporte" : "hoje"}</span></div>
            </div>
            <ul className="alloc-rows">
              {shown.map((g) => {
                const now = base > 0 ? inner[g] / base : 0;
                const tg = pct[g] ?? 0;
                const gap = tg * base - inner[g];
                return (
                  <li key={g}>
                    <div className="alloc-row-top"><span><i className={`dot g-${g}`} aria-hidden="true" />{label(g)}</span>
                      <span className="alloc-row-pct">{plan ? "fica" : "hoje"} <b>{pctS(now)}</b> · alvo <b>{pctS(tg)}</b></span></div>
                    <div className="alloc-bar" style={{ "--now": Math.min(1, now), "--tg": Math.min(1, tg), "--c": `var(--g-${g})` } as React.CSSProperties}>
                      <span className="fill" /><span className="mark" aria-hidden="true" /></div>
                    <div className="alloc-row-foot">
                      <span>{brl(inner[g])}</span>
                      {Math.abs(gap) < 1 ? <span className="pos">no alvo</span> : gap > 0 ? <span className="pos">faltam {brl(gap)}</span> : <span className="ls-soft">acima {brl(-gap)}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="alloc-ap">
            <label className="alloc-ap-in">Quanto vai investir agora?
              <span><em>R$</em><input value={aporte} inputMode="decimal" onChange={(e) => setAporte(e.target.value)} placeholder="1.000,00" /></span></label>
            {plan && (
              <div className="alloc-ap-out">
                {plan.toReserve > 0.004 && <span className="alloc-chip res"><i />Reserva <b>{brl(plan.toReserve)}</b></span>}
                {groups.filter((g) => plan.parts[g] > 0.004).sort((x, y) => plan.parts[y] - plan.parts[x]).map((g) => (
                  <span key={g} className="alloc-chip" style={{ "--c": `var(--g-${g})` } as React.CSSProperties}><i />{label(g)} <b>{brl(plan.parts[g])}</b></span>
                ))}
              </div>
            )}
            <p className="mes-line">Organização da sua própria divisão, não é recomendação de investimento. Nada é lançado: é só a conta.</p>
          </div>
        </Card>
      )}
      <Sheet open={editing} onClose={() => setEditing(false)} title="Sua alocação alvo" width={600}>
        {editing && <TargetForm groups={groups} cur={cur} total={total} target={target} onCancel={() => setEditing(false)}
          onSave={async (t) => { setTarget(t); setEditing(false); await onSave(t); }} />}
      </Sheet>
    </Section>
  );
}

// Folha "Definir alvo": % de cada classe (deslizante + campo), soma travada em 100, meta da reserva em meses
function TargetForm({ groups, cur, total, target, onSave, onCancel }: {
  groups: FinGroup[]; cur: Record<string, number>; total: number; target: TargetCfg | undefined; onSave: (t: TargetCfg) => Promise<void>; onCancel: () => void;
}) {
  const [p, setP] = useState<Record<string, number>>(() => Object.fromEntries(groups.map((g) => [g, Math.round((target?.pct[g] ?? 0) * 100)])));
  const [months, setMonths] = useState(String(target?.reserveMonths ?? 6));
  const [busy, setBusy] = useState(false);
  const sum = groups.reduce((s, g) => s + (p[g] || 0), 0);
  const fromToday = () => {
    if (!(total > 0)) return;
    const raw = groups.map((g) => [g, (cur[g] / total) * 100] as const);
    const r = raw.map(([g, v]) => [g, Math.floor(v)] as [string, number]);
    let left = 100 - r.reduce((s, [, v]) => s + v, 0);
    // distribui o que sobra do arredondamento para os maiores restos
    for (const [g] of [...raw].sort((x, y) => (y[1] % 1) - (x[1] % 1))) { if (left <= 0) break; const it = r.find((x) => x[0] === g)!; it[1]++; left--; }
    setP(Object.fromEntries(r));
  };
  const ok = sum === 100 && num(months) > 0;
  return (
    <div className="alloc-form">
      <p className="mes-line">Escolha quanto do que você investe quer em cada classe. A reserva de emergência vem antes e fica fora das %.</p>
      {groups.map((g) => (
        <div key={g} className="alloc-form-row">
          <span className="alloc-form-name"><i className={`dot g-${g}`} aria-hidden="true" />{label(g)}
            {total > 0 && <small>hoje {pctS(cur[g] / total)}</small>}</span>
          <input type="range" min={0} max={100} step={1} value={p[g] || 0} onChange={(e) => setP({ ...p, [g]: Number(e.target.value) })}
            aria-label={`${label(g)}: porcentagem do alvo`} style={{ "--c": `var(--g-${g})` } as React.CSSProperties} />
          <span className="alloc-form-pct"><input value={p[g] || 0} inputMode="numeric" onChange={(e) => setP({ ...p, [g]: Math.max(0, Math.min(100, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0))) })}
            aria-label={`${label(g)} em %`} />%</span>
        </div>
      ))}
      <div className={sum === 100 ? "alloc-sum ok" : "alloc-sum"}>
        <span>Soma</span><b>{sum}%</b>
        {sum !== 100 && <Badge tone="warn">{sum < 100 ? `faltam ${100 - sum}%` : `passou ${sum - 100}%`}</Badge>}
      </div>
      <div className="alloc-form-res">
        <label>Reserva de emergência (meses de gasto)<input value={months} inputMode="decimal" onChange={(e) => setMonths(e.target.value)} /></label>
      </div>
      <div className="alloc-form-acts">
        {total > 0 && <Button size="sm" onClick={fromToday}>Preencher com a carteira de hoje</Button>}
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button variant="primary" disabled={!ok || busy} onClick={async () => {
          setBusy(true);
          try { await onSave({ pct: Object.fromEntries(groups.filter((g) => (p[g] || 0) > 0).map((g) => [g, (p[g] || 0) / 100])), reserveMonths: Math.round(num(months) * 10) / 10 }); }
          finally { setBusy(false); }
        }}>Salvar alvo</Button>
      </div>
    </div>
  );
}
