"use client";
import type { PerfPoint } from "@/lib/performance";

// Lucro/prejuizo acumulado: seu resultado real x a estrategia seguida a risca, com linha do zero
export default function PerfChart({ points }: { points: PerfPoint[] }) {
  const W = 640;
  const H = 200;
  const vals = [0, ...points.flatMap((p) => [p.real, p.strat])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * (H - 16) - 8;
  const path = (key: "real" | "strat") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Lucro real x estratégia">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="zero" />
      <path d={path("strat")} className="l-strat" />
      <path d={path("real")} className="l-real" />
    </svg>
  );
}
