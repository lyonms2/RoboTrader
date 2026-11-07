"use client";
import { useState } from "react";
import type { WalletHistoryDoc, WalletItem } from "@/lib/types";
import type { ClassTotals } from "@/lib/walletMath";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// Ordem fixa das classes (a cor segue a classe, nunca a posicao)
const CLASSES: { key: WalletItem["cls"]; label: string }[] = [
  { key: "stable", label: "Dolar" }, { key: "BTC", label: "BTC" }, { key: "ETH", label: "ETH" },
  { key: "SOL", label: "SOL" }, { key: "outro", label: "Outros" },
];

// Barra 100% empilhada: quanto do patrimonio esta em cada classe
export function AllocationBar({ byClass }: { byClass: ClassTotals }) {
  const [hover, setHover] = useState<string | null>(null);
  const parts = CLASSES.map((c) => ({ ...c, value: Math.max(0, byClass[c.key]) })).filter((c) => c.value > 0.005);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return null;
  const W = 640;
  const GAP = 2;
  const usable = W - GAP * (parts.length - 1);
  let x = 0;
  const segs = parts.map((p) => {
    const w = Math.max(2, (p.value / total) * usable);
    const s = { ...p, x, w, pct: (p.value / total) * 100 };
    x += w + GAP;
    return s;
  });
  const hov = segs.find((s) => s.key === hover);
  return (
    <figure className="viz">
      <figcaption className="small muted">Patrimonio por classe {hov ? `- ${hov.label}: ${fmt(hov.value)} USD (${fmt(hov.pct, 1)}%)` : ""}</figcaption>
      <svg viewBox={`0 0 ${W} 22`} preserveAspectRatio="none" className="alloc" role="img" aria-label="Patrimonio por classe" onMouseLeave={() => setHover(null)}>
        {segs.map((s) => (
          <rect key={s.key} x={s.x} y={0} width={s.w} height={22} rx={4} className={`c-${s.key}${hover && hover !== s.key ? " dim" : ""}`}
            onMouseEnter={() => setHover(s.key)}>
            <title>{`${s.label}: ${fmt(s.value)} USD (${fmt(s.pct, 1)}%)`}</title>
          </rect>
        ))}
      </svg>
      <ul className="viz-legend small">
        {segs.map((s) => (
          <li key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
            <i className={`c-${s.key}`} />{s.label} <b>{fmt(s.pct, 1)}%</b> <span className="muted">{fmt(s.value)} USD</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// Barras horizontais: valor em cada protocolo (uma serie so, uma cor)
export function ProtocolBars({ rows, total }: { rows: { app: string; value: number }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!(max > 0)) return null;
  return (
    <figure className="viz">
      <figcaption className="small muted">Valor por protocolo</figcaption>
      <div className="hbars">
        {rows.filter((r) => r.value > 0).map((r) => (
          <div key={r.app} className="hbar" title={`${r.app}: ${fmt(r.value)} USD (${fmt((r.value / total) * 100, 1)}%)`}>
            <span className="hbar-label small">{r.app}</span>
            <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="hbar-value small">{fmt(r.value)} <span className="muted">{fmt((r.value / total) * 100, 0)}%</span></span>
          </div>
        ))}
      </div>
    </figure>
  );
}

// Linha: patrimonio total ao longo do tempo (1 ponto por dia), com cursor e valor ao passar o mouse
export function HistoryLine({ history }: { history: WalletHistoryDoc[] }) {
  const [idx, setIdx] = useState<number | null>(null);
  if (history.length < 2)
    return <p className="muted small">Evolucao do patrimonio: o grafico aparece a partir do 2o dia de leituras (1 ponto por dia).</p>;
  const W = 640;
  const H = 170;
  const PADL = 4;
  const vals = history.map((h) => h.total);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || hi * 0.02 || 1;
  const x = (i: number) => PADL + (i / (history.length - 1)) * (W - PADL * 2);
  const y = (v: number) => H - 18 - ((v - (lo - pad)) / (hi - lo + pad * 2)) * (H - 30);
  const path = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.total).toFixed(1)}`).join("");
  const first = history[0];
  const last = history[history.length - 1];
  const chg = last.total - first.total;
  const cur = idx !== null ? history[idx] : null;
  const date = (t: number) => new Date(t).toLocaleDateString("pt-BR");
  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    setIdx(Math.max(0, Math.min(history.length - 1, Math.round(((fx - PADL) / (W - PADL * 2)) * (history.length - 1)))));
  }
  return (
    <figure className="viz">
      <figcaption className="small muted">
        Evolucao do patrimonio{" "}
        {cur ? <>- {date(cur.t)}: <b className="ink">{fmt(cur.total)} USD</b></> : <>desde {date(first.t)}: <b className={chg >= 0 ? "pos" : "neg"}>{chg >= 0 ? "+" : ""}{fmt(chg)} USD</b></>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Evolucao do patrimonio" onMouseMove={move} onMouseLeave={() => setIdx(null)}>
        <line x1={0} x2={W} y1={y(hi)} y2={y(hi)} className="grid" />
        <line x1={0} x2={W} y1={y(lo)} y2={y(lo)} className="grid" />
        <text x={W - 2} y={y(hi) - 4} className="axis" textAnchor="end">{fmt(hi, 0)}</text>
        <text x={W - 2} y={y(lo) + 12} className="axis" textAnchor="end">{fmt(lo, 0)}</text>
        <text x={2} y={H - 2} className="axis">{date(first.t)}</text>
        <text x={W - 2} y={H - 2} className="axis" textAnchor="end">{date(last.t)}</text>
        <path d={path} className="l-real" />
        {cur && idx !== null && (
          <>
            <line x1={x(idx)} x2={x(idx)} y1={0} y2={H - 16} className="cross" />
            <circle cx={x(idx)} cy={y(cur.total)} r={4} className="dot" />
          </>
        )}
      </svg>
    </figure>
  );
}
