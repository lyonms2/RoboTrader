"use client";
import { addDoc, collection, doc, setDoc, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { applyTrade, rebuild } from "@/lib/ledger";
import { SYMBOLS, type AppConfig, type LatestDoc, type TradeDoc } from "@/lib/types";
import { type Prices } from "../usePrices";
import { ask } from "../Dialog";
import { currentPrice, fmt, fmtPx, fmtQty, ordered, round8 } from "./util";

export function TradeForm({ cfg, latest, prices }: { cfg: AppConfig; latest: LatestDoc[]; prices: Prices }) {
  const symbols = ordered(Object.keys(cfg.weights));
  const [symbol, setSymbol] = useState(symbols[0] ?? "BTCUSDT");
  const [side, setSide] = useState<"compra" | "venda">("compra");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    const q = Number(qty.replace(",", "."));
    const l = latest.find((x) => x.symbol === symbol);
    const p = Number(price.replace(",", ".")) || (l ? currentPrice(l, prices).price : 0);
    if (!(q > 0)) return setMsg("Informe a quantidade.");
    if (!(p > 0)) return setMsg("Informe o preço.");
    const { pos: next, avg: nextAvg, realized } = applyTrade(
      { pos: cfg.positions[symbol] ?? 0, avg: cfg.avgPrice?.[symbol] ?? 0, realized: cfg.realized?.[symbol] ?? 0 }, side, q, p);
    await addDoc(collection(db(), "trades"), { symbol, side, qty: q, price: p, t: Date.now() } satisfies TradeDoc);
    await setDoc(doc(db(), "config/main"),
      { positions: { [symbol]: round8(next) }, avgPrice: { [symbol]: round8(nextAvg) }, realized: { [symbol]: round8(realized) } },
      { merge: true });
    setQty("");
    setPrice("");
    setMsg(`Registrado. Posição em ${symbol}: ${fmtQty(next)}${next > 0 ? ` a preço médio ${fmtPx(nextAvg)}` : ""}.`);
  }

  return (
    <section className="card">
      <h2>Registrar operação manual</h2>
      <div className="info-box small">
        <b>Comprou ou vendeu numa carteira cadastrada (Rabby, Phantom...)? Não precisa lançar nada.</b> O site lê o saldo das carteiras
        sozinho quando você clica em &quot;Atualizar&quot; (e o agendador atualiza ao longo do dia); as operações da Lighter também entram sozinhas quando a importação dela está ligada na engrenagem.
        Use este formulário só para o que foi feito fora das carteiras cadastradas, por exemplo numa carteira que não está na engrenagem.
      </div>
      <div className="row wrap-row">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{symbols.map((s) => <option key={s} value={s}>{s.replace("USDT", "")}</option>)}</select>
        <select value={side} onChange={(e) => setSide(e.target.value as "compra" | "venda")}><option value="compra">compra</option><option value="venda">venda</option></select>
        <input placeholder="quantidade" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        <input placeholder="preço (vazio = atual)" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        <button onClick={save}>Registrar</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}

export const PAGE_SIZE = 10;

// Historico de operacoes: busca livre, filtro por moeda e lado, 10 por pagina
export type TradeRow = TradeDoc & { id: string };

// Grava a mudanca na operacao e refaz posicao, preco medio e realizado das moedas afetadas a partir do historico
export async function saveTradeChange(all: TradeRow[], change: { id: string; next: TradeDoc | null }) {
  const old = all.find((t) => t.id === change.id);
  const after = all.filter((t) => t.id !== change.id).concat(change.next ? [{ ...change.next, id: change.id }] : []);
  const symbols = [...new Set([old?.symbol, change.next?.symbol].filter((s): s is string => !!s))];
  const batch = writeBatch(db());
  const ref = doc(db(), "trades", change.id);
  if (change.next) batch.set(ref, change.next);
  else batch.delete(ref);
  const books = Object.fromEntries(symbols.map((s) => [s, rebuild(after, s)]));
  batch.set(doc(db(), "config/main"), {
    positions: Object.fromEntries(symbols.map((s) => [s, books[s].pos])),
    avgPrice: Object.fromEntries(symbols.map((s) => [s, books[s].avg])),
    realized: Object.fromEntries(symbols.map((s) => [s, books[s].realized])),
  }, { merge: true });
  await batch.commit();
  return books;
}

export const toLocalInput = (t: number) => {
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const RECALC_NOTE = "A posição, o preço médio e o realizado da moeda serão refeitos a partir de TODAS as operações registradas dela " +
  "(ajustes feitos à mão na Configuração serão substituídos).";

export type Editing = { id: string; symbol: string; side: TradeDoc["side"]; qty: string; price: string; when: string };

export function TradesTable({ trades }: { trades: TradeRow[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [coin, setCoin] = useState("");
  const [side, setSide] = useState("");
  const [page, setPage] = useState(0);
  const coins = ordered([...new Set(trades.map((t) => t.symbol))]);
  const q = search.trim().toLowerCase();
  const rows = trades.filter((t) => {
    if (coin && t.symbol !== coin) return false;
    if (side && t.side !== side) return false;
    if (!q) return true;
    const text = [new Date(t.t).toLocaleString("pt-BR"), t.symbol, t.side, fmtQty(t.qty), fmtPx(t.price), String(t.qty), String(t.price), t.source ?? "manual", t.note ?? ""]
      .join(" ").toLowerCase();
    return text.includes(q);
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => setPage(0), [search, coin, side]);

  const summary = (books: Record<string, { pos: number; avg: number }>) =>
    Object.entries(books).map(([s, b]) => `${s.replace("USDT", "")}: ${fmtQty(b.pos)}${b.pos > 0 ? ` a ${fmtPx(b.avg)}` : ""}`).join(" | ");

  async function saveEdit() {
    if (!editing) return;
    const q = Number(editing.qty.replace(",", "."));
    const p = Number(editing.price.replace(",", "."));
    const t = new Date(editing.when).getTime();
    if (!(q > 0) || !(p > 0) || !Number.isFinite(t)) return setMsg("Quantidade, preço e data precisam ser válidos.");
    if (!await ask(`Salvar a alteração?\n\n${RECALC_NOTE}`)) return;
    try {
      const books = await saveTradeChange(trades, {
        id: editing.id, next: { symbol: editing.symbol, side: editing.side, qty: round8(q), price: round8(p), t },
      });
      setEditing(null);
      setMsg(`Operação alterada. Posição agora: ${summary(books)}.`);
    } catch (e) {
      setMsg(`Não foi possível salvar: ${String(e)}`);
    }
  }

  async function remove(t: TradeRow) {
    const what = `${t.side} de ${fmtQty(t.qty)} ${t.symbol.replace("USDT", "")} a ${fmtPx(t.price)} em ${new Date(t.t).toLocaleString("pt-BR")}`;
    if (!await ask(`Excluir a ${what}?\n\n${RECALC_NOTE}`)) return;
    try {
      const books = await saveTradeChange(trades, { id: t.id, next: null });
      setMsg(`Operação excluída. Posição agora: ${summary(books)}.`);
    } catch (e) {
      setMsg(`Não foi possível excluir: ${String(e)}`);
    }
  }

  return (
    <section className="card">
      <div className="row between wrap-row trades-head">
        <h2>Operações registradas</h2>
        <div className="row wrap-row">
          <input type="search" placeholder="Buscar (data, moeda, preço...)" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={coin} onChange={(e) => setCoin(e.target.value)} aria-label="Moeda">
            <option value="">Todas as moedas</option>
            {coins.map((c) => <option key={c} value={c}>{c.replace("USDT", "")}</option>)}
          </select>
          <select value={side} onChange={(e) => setSide(e.target.value)} aria-label="Lado">
            <option value="">Compra e venda</option>
            <option value="compra">compra</option>
            <option value="venda">venda</option>
          </select>
        </div>
      </div>
      {!trades.length ? (
        <p className="muted">Nenhuma ainda.</p>
      ) : !rows.length ? (
        <p className="muted">Nenhuma operação encontrada com esses filtros.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="stack">
              <thead><tr><th>Data</th><th>Moeda</th><th>Lado</th><th>Qtd</th><th>Preço</th><th>Valor (USDT)</th><th /></tr></thead>
              <tbody>
                {shown.map((t) => editing?.id === t.id ? (
                  <tr key={t.id} className="editing">
                    <td><input type="datetime-local" value={editing.when} onChange={(e) => setEditing({ ...editing, when: e.target.value })} /></td>
                    <td>
                      <select value={editing.symbol} onChange={(e) => setEditing({ ...editing, symbol: e.target.value })}>
                        {ordered([...new Set([...SYMBOLS, editing.symbol])]).map((c) => <option key={c} value={c}>{c.replace("USDT", "")}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={editing.side} onChange={(e) => setEditing({ ...editing, side: e.target.value as TradeDoc["side"] })}>
                        <option value="compra">compra</option><option value="venda">venda</option>
                      </select>
                    </td>
                    <td><input value={editing.qty} inputMode="decimal" onChange={(e) => setEditing({ ...editing, qty: e.target.value })} /></td>
                    <td><input value={editing.price} inputMode="decimal" onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></td>
                    <td className="muted">{fmt((Number(editing.qty.replace(",", ".")) || 0) * (Number(editing.price.replace(",", ".")) || 0))}</td>
                    <td className="actions">
                      <button className="icon" onClick={saveEdit} title="Salvar" aria-label="Salvar">&#x2713;</button>
                      <button className="ghost icon" onClick={() => setEditing(null)} title="Cancelar" aria-label="Cancelar">&#x2715;</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id}>
                    <td>{new Date(t.t).toLocaleString("pt-BR")}</td>
                    <td data-label="Moeda">{t.symbol.replace("USDT", "")}{t.source === "lighter" && <span className="tag">Lighter</span>}</td>
                    <td data-label="Lado" className={t.side === "compra" ? "pos" : "neg"}>{t.side}{t.note ? ` (${t.note})` : ""}</td>
                    <td data-label="Qtd">{fmtQty(t.qty)}</td>
                    <td data-label="Preço">{fmtPx(t.price)}</td>
                    <td data-label="Valor (USDT)">{fmt(t.qty * t.price)}</td>
                    <td className="actions">{t.source === "lighter" ? <span className="muted small" title="Importada da Lighter: edite la">auto</span> : <>
                      <button className="ghost icon" title="Editar" aria-label="Editar"
                        onClick={() => setEditing({ id: t.id, symbol: t.symbol, side: t.side, qty: String(t.qty), price: String(t.price), when: toLocalInput(t.t) })}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      </button>
                      <button className="ghost icon danger" title="Excluir" aria-label="Excluir" onClick={() => remove(t)}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {msg && <p className="muted small">{msg}</p>}
          <div className="row between pager">
            <span className="muted small">
              {rows.length} opera{rows.length === 1 ? "ção" : "ções"}{rows.length !== trades.length ? ` (de ${trades.length})` : ""}
            </span>
            <div className="row">
              <button className="ghost" onClick={() => setPage(cur - 1)} disabled={cur === 0}>Anterior</button>
              <span className="small">Página {cur + 1} de {pages}</span>
              <button className="ghost" onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1}>Próxima</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
