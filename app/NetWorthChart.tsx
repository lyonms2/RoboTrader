"use client";
import { useEffect, useRef, useState } from "react";
import { GROUPS } from "@/lib/financeMath";
import type { NetWorthDoc } from "@/lib/patrimonio";

import Note from "./Note";
const fmt = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 0) => `R$ ${fmt(v, d)}`;
const date = (t: number) => new Date(t).toLocaleDateString("pt-BR");
const RANGES = [
  { id: "1m", label: "1M", days: 31 }, { id: "3m", label: "3M", days: 92 }, { id: "6m", label: "6M", days: 183 },
  { id: "1a", label: "1A", days: 366 }, { id: "tudo", label: "Tudo", days: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

// Evolucao do patrimonio liquido: 1 ponto por dia (foto gravada no Atualizar tudo / agendador) + o valor de agora
export default function NetWorthChart({ hist, live }: { hist: NetWorthDoc[]; live: NetWorthDoc | null }) {
  const [range, setRange] = useState<RangeId>("tudo");
  const [withBens, setWithBens] = useState(false);
  const [idx, setIdx] = useState<number | null>(null);
  // Largura real do grafico (para o texto nao encolher no celular)
  const box = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hist.length, range]); // o grafico so aparece com 2+ pontos
  // Sem bens: tira imoveis/veiculos do liquido e dos bens (byGroup.bens; fotos antigas nao tem e contam 0)
  const adj = (p: NetWorthDoc): NetWorthDoc => {
    const b = withBens ? 0 : p.byGroup?.bens ?? 0;
    return { ...p, net: p.net - b, bens: p.bens - b };
  };
  const hasBens = [...hist, ...(live ? [live] : [])].some((p) => (p.byGroup?.bens ?? 0) > 0);
  // Hoje: o valor calculado agora substitui a foto do dia
  const all0 = [...hist.filter((h) => !live || h.day !== live.day), ...(live && (live.bens > 0 || live.dividas > 0) ? [live] : [])].sort((a, b) => a.t - b.t);
  const all = all0.map(adj);
  const span = all.length ? (all[all.length - 1].t - all[0].t) / 86_400_000 : 0;
  const avail = RANGES.filter((r) => r.days === Infinity || span > r.days * 0.6);
  const days = RANGES.find((r) => r.id === range)!.days;
  const pts = days === Infinity ? all : all.filter((p) => p.t >= Date.now() - days * 86_400_000);

  if (pts.length < 2)
    return (
      <section className="card">
        <h2>Evolução do patrimônio</h2>
        <p className="muted small">
          O gráfico começa hoje{all[0] ? ` (${brl(all[0].net)})` : ""}: a cada dia em que o agendador roda (ou você clica em &quot;Atualizar&quot;, em Cripto)
          fica gravada uma foto do patrimônio líquido. A linha aparece a partir do 2o dia.
        </p>
      </section>
    );

  const W = Math.max(280, width);
  const H = W < 500 ? 190 : 210;
  const PL = 4;
  const PR = 4;
  const hasDebt = pts.some((p) => p.dividas > 0.5);
  const vals = pts.flatMap((p) => (hasDebt ? [p.net, p.bens] : [p.net]));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.03 || 1;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => PL + ((t - t0) / (t1 - t0 || 1)) * (W - PL - PR);
  const y = (v: number) => H - 20 - ((v - (lo - pad)) / (hi - lo + pad * 2)) * (H - 34);
  const line = (k: "net" | "bens") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const area = `${line("net")}L${x(t1).toFixed(1)},${H - 20}L${x(t0).toFixed(1)},${H - 20}Z`;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const chg = last.net - first.net;
  const chgPct = first.net > 0 ? chg / first.net : null;
  const cur = idx !== null ? pts[idx] : last;

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - PL) / (W - PL - PR) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - t) < Math.abs(pts[best].t - t)) best = i;
    setIdx(best);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Evolução do patrimônio</h2>
        <div className="ranges" role="group" aria-label="Período">
          {hasBens && (
            <>
              <button className={!withBens ? "pill on" : "pill"} onClick={() => setWithBens(false)}>sem bens</button>
              <button className={withBens ? "pill on" : "pill"} onClick={() => setWithBens(true)}>com bens</button>
              <span className="sep" />
            </>
          )}
          {avail.map((r) => (
            <button key={r.id} className={range === r.id ? "pill on" : "pill"} onClick={() => { setRange(r.id); setIdx(null); }}>{r.label}</button>
          ))}
        </div>
      </div>
      <div className="nw-head">
        <div>
          <span className="muted small">{idx !== null ? date(cur.t) : `Patrimônio líquido${hasBens ? (withBens ? " com bens" : " sem bens") : ""} agora`}</span>
          <b>{brl(cur.net)}</b>
        </div>
        {idx === null ? (
          <div className={chg >= 0 ? "pos" : "neg"}>
            <span className="muted small">desde {date(first.t)}</span>
            <b>{chg >= 0 ? "+" : "-"}{brl(Math.abs(chg))}{chgPct !== null && <small> ({chg >= 0 ? "+" : ""}{fmt(chgPct * 100, 1)}%)</small>}</b>
          </div>
        ) : (
          <div>
            <span className="muted small">tem - deve</span>
            <b className="small-b">{brl(cur.bens)} - {brl(cur.dividas)}</b>
          </div>
        )}
      </div>
      {(() => {
        // O que mais mexeu no patrimonio entre o primeiro ponto e o ponto mostrado (efeito no liquido)
        const recv = (p: NetWorthDoc) => p.bens - Object.values(p.byGroup ?? {}).reduce((t, v) => t + v, 0);
        const parts = [
          ...GROUPS.map((g) => ({ k: g.label, v: (cur.byGroup?.[g.key] ?? 0) - (first.byGroup?.[g.key] ?? 0) })),
          { k: "A receber", v: recv(cur) - recv(first) },
          { k: "Dívidas", v: -(cur.dividas - first.dividas) },
        ].filter((x) => Math.abs(x.v) >= 1).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 4);
        if (!parts.length || cur === first) return null;
        return (
          <p className="nw-why small"><span className="muted">O que mais mudou desde {date(first.t)}:</span>
            {parts.map((x) => <span key={x.k} className="chip"><span className="muted">{x.k === "Dívidas" ? (x.v < 0 ? "Dívidas a mais" : "Dívidas a menos") : x.k}</span> <b className={x.v >= 0 ? "pos" : "neg"}>{x.v >= 0 ? "+" : "-"}{brl(Math.abs(x.v))}</b></span>)}
          </p>
        );
      })()}
      <figure className="viz" ref={box}>
        {hasDebt && (
          <figcaption className="small muted"><i className="key k-net" /> patrimônio líquido <i className="key k-bens" /> tudo o que você tem (antes das dívidas)</figcaption>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="chart nw" role="img" aria-label="Evolução do patrimônio líquido"
          onPointerMove={move} onPointerLeave={() => setIdx(null)}>
          <line x1={0} x2={W} y1={y(hi)} y2={y(hi)} className="grid" />
          <line x1={0} x2={W} y1={y(lo)} y2={y(lo)} className="grid" />
          <text x={W - 2} y={y(hi) - 4} className="axis" textAnchor="end">{brl(hi)}</text>
          <text x={W - 2} y={y(lo) + 13} className="axis" textAnchor="end">{brl(lo)}</text>
          <text x={2} y={H - 4} className="axis">{date(t0)}</text>
          <text x={W - 2} y={H - 4} className="axis" textAnchor="end">{date(t1)}</text>
          <path d={area} className="nw-area" />
          {hasDebt && <path d={line("bens")} className="nw-bens" />}
          <path d={line("net")} className="l-real" />
          {idx !== null && (
            <>
              <line x1={x(cur.t)} x2={x(cur.t)} y1={0} y2={H - 20} className="cross" />
              <circle cx={x(cur.t)} cy={y(cur.net)} r={4} className="dot" />
            </>
          )}
        </svg>
      </figure>
      <ul className="viz-legend small">
        {GROUPS.filter((g) => (cur.byGroup?.[g.key] ?? 0) > 0.5).map((g) => (
          <li key={g.key}><i className={`g-${g.key}`} />{g.label} <b>{brl(cur.byGroup[g.key])}</b></li>
        ))}
      </ul>
      <Note>
        Uma foto por dia, gravada pelo agendador (ou quando você clica em &quot;Atualizar&quot;, em Cripto); o último ponto e o valor de agora.
        A linha não mostra só ganho ou perda: cadastrar uma dívida, um cartão ou um investimento novo também muda o patrimônio daquele dia
        em diante. &quot;O que mais mudou&quot; mostra de onde veio a diferença.
        {cur.partial?.length ? ` Neste dia ficou de fora: ${cur.partial.join(", ")}.` : ""}
      </Note>
    </section>
  );
}
