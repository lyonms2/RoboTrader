"use client";
import { useEffect, useState } from "react";

export type Prices = { values: Record<string, number>; at: number | null };

// Preco atual direto da Binance (publico), atualizado a cada 30 s enquanto a pagina esta aberta.
// Se falhar (rede, bloqueio), o painel usa o preco do ultimo recalculo do servidor.
export function usePrices(symbols: string[], everyMs = 30_000): Prices {
  const [prices, setPrices] = useState<Prices>({ values: {}, at: null });
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      try {
        const q = encodeURIComponent(JSON.stringify(key.split(",")));
        const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${q}`, { cache: "no-store" });
        if (!res.ok) return;
        const rows = (await res.json()) as { symbol: string; price: string }[];
        if (alive) setPrices({ values: Object.fromEntries(rows.map((r) => [r.symbol, Number(r.price)])), at: Date.now() });
      } catch {
        // mantem o ultimo valor
      }
    };
    load();
    const id = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, everyMs]);
  return prices;
}
