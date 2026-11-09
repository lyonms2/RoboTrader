"use client";
import type { LatestDoc } from "@/lib/types";

// Grafico simples: fechamento, SMA e HMA, com faixa verde nos dias em que a estrategia esteve comprada
export default function Chart({ chart }: { chart: LatestDoc["chart"] }) {
  const W = 640;
  const H = 220;
  const vals = [...chart.close, ...chart.sma.filter((v): v is number => v !== null)];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const n = chart.close.length;
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * (H - 10) - 5;
  const path = (arr: (number | null)[]) =>
    arr.map((v, i) => (v === null ? "" : `${i === 0 || arr[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join("");
  const bands: [number, number][] = [];
  chart.on.forEach((on, i) => {
    if (on && (i === 0 || !chart.on[i - 1])) bands.push([i, i]);
    if (on) bands[bands.length - 1][1] = i;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Preço, SMA e HMA">
      {bands.map(([a, b]) => (
        <rect key={a} x={x(a)} y={0} width={Math.max(1, x(b) - x(a))} height={H} className="band" />
      ))}
      <path d={path(chart.sma)} className="l-sma" />
      <path d={path(chart.hma)} className="l-hma" />
      <path d={path(chart.close)} className="l-close" />
    </svg>
  );
}
