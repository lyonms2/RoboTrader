"use client";
import { useEffect, useState } from "react";
import { SYMBOLS, type AppConfig, type LatestDoc } from "@/lib/types";
import { type Prices } from "../usePrices";

export const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// Sem arredondar: quantidades com ate 8 casas (precisao da corretora) e precos com 2 a 8 casas
export const fmtQty = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 8 });
export const fmtPx = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
export const day = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "UTC" });
export const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "agora" : `há ${m} min`;
};
export const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${fmt(v, d)}`;
export const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
// Evita lixo de ponto flutuante (0.022719999999999997) nas quantidades e precos salvos
export const round8 = (v: number) => Math.round(v * 1e8) / 1e8;
// Moedas na ordem fixa BTC, ETH, SOL (o Firestore nao garante a ordem das chaves)
export const ordered = (keys: string[]) =>
  [...keys].sort((a, b) => (SYMBOLS.indexOf(a) + 1 || 99) - (SYMBOLS.indexOf(b) + 1 || 99));

export type Px = { price: number; at: number; live: boolean };

// Preco atual: Binance ao vivo (30 s) ou, se indisponivel, o do ultimo recalculo do servidor
export function priceOf(symbol: string, latest: LatestDoc[], prices: Prices): Px | null {
  const live = prices.values[symbol];
  if (live && prices.at) return { price: live, at: prices.at, live: true };
  const l = latest.find((x) => x.symbol === symbol);
  return l ? { price: l.preview?.state.close ?? l.state.close, at: l.updatedAt, live: false } : null;
}
export const currentPrice = (l: LatestDoc, prices: Prices): Px => priceOf(l.symbol, [l], prices) as Px;

// Lucro/prejuizo da posicao aberta (sem taxas e funding)
export function openPnl(cfg: AppConfig, symbol: string, price: number) {
  const pos = cfg.positions[symbol] ?? 0;
  const avg = cfg.avgPrice?.[symbol] ?? 0;
  if (!(pos > 0 && avg > 0)) return { usdt: 0, pct: 0, known: !(pos > 0) };
  return { usdt: pos * (price - avg), pct: (price / avg - 1) * 100, known: true };
}

// Campo numerico que aceita digitar "0," ou "0.004" antes de virar numero
export function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(round8(value)));
  useEffect(() => {
    setText((t) => (Number(t.replace(",", ".")) === value ? t : String(round8(value))));
  }, [value]);
  return (
    <input value={text} inputMode="decimal"
      onChange={(e) => { setText(e.target.value); onChange(Number(e.target.value.replace(",", ".")) || 0); }} />
  );
}

export type TabId = "geral" | "financas" | "sinais" | "carteira" | "tokens" | "operacoes" | "ajuda";
// Sub-abas de Cripto (continuam sendo "abas" por dentro, para os links da Visao geral abrirem direto a certa)
export const CRYPTO_TABS: TabId[] = ["sinais", "carteira", "tokens", "operacoes"];

// Janela sobreposta: fecha no X, no Esc ou clicando fora
export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}
