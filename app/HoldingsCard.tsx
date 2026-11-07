"use client";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import type { AppConfig, WalletDoc } from "@/lib/types";
import { holdings, type Row } from "@/lib/holdings";

export { holdings };

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const qtyFmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: v >= 1 ? 4 : 8 });
// Preco com casas suficientes para tokens baratos
const pxFmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v >= 1 ? 2 : v >= 0.01 ? 4 : 8 });
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${fmt(v, d)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

// Totais dos tokens (fora stablecoins) para o resumo da carteira
export function holdingsSummary(rows: Row[]) {
  const tokens = rows.filter((r) => !r.stable);
  const known = tokens.filter((r) => r.cost !== null);
  return {
    tokens: tokens.reduce((s, r) => s + r.value, 0),
    count: tokens.length,
    known: known.length,
    cost: known.reduce((s, r) => s + (r.cost ?? 0), 0),
    pnl: known.reduce((s, r) => s + (r.pnl ?? 0), 0),
  };
}

// Meus tokens: o que voce tem nas carteiras, preco atual, preco medio e lucro/prejuizo
export default function HoldingsCard({ wallet, cfg }: { wallet: WalletDoc; cfg: AppConfig }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [showStables, setShowStables] = useState(false);
  const rows = holdings(wallet, cfg.costBasis);
  const tokens = rows.filter((r) => !r.stable);
  const stables = rows.filter((r) => r.stable);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const stableTotal = stables.reduce((s, r) => s + r.value, 0);

  async function saveAvg(symbol: string, value: number | null) {
    // updateDoc com caminho do campo: apagar ("limpar") remove so este token
    await updateDoc(doc(db(), "config/main"), { [`costBasis.${symbol.toUpperCase()}`]: value && value > 0 ? value : deleteField() });
    setEditing(null);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Meus tokens</h2>
        <span className="muted small">clique no preco medio para editar</span>
      </div>
      {tokens.length ? (
        <div className="table-scroll">
          <table className="holdings stack">
            <thead>
              <tr><th>Token</th><th>Quantidade</th><th>Preco atual</th><th>Valor</th><th>Preco medio</th><th>Lucro / prejuizo</th></tr>
            </thead>
            <tbody>
              {tokens.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <b>{r.symbol}</b> <span className="muted small">{total > 0 ? `${fmt((r.value / total) * 100, 1)}%` : ""}</span>
                    <div className="muted small">{r.where.join(", ")}</div>
                  </td>
                  <td data-label="Quantidade">{qtyFmt(r.qty)}</td>
                  <td data-label="Preco atual">${pxFmt(r.price)}</td>
                  <td data-label="Valor">${fmt(r.value)}</td>
                  <td data-label="Preco medio"><span>
                    {editing === r.symbol ? (
                      <span className="avg-edit">
                        <input autoFocus inputMode="decimal" value={text} placeholder="preco medio"
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveAvg(r.symbol, Number(text.replace(",", ".")) || null);
                            if (e.key === "Escape") setEditing(null);
                          }} />
                        <button className="icon" title="Salvar" onClick={() => saveAvg(r.symbol, Number(text.replace(",", ".")) || null)}>&#x2713;</button>
                        <button className="ghost icon" title="Cancelar" onClick={() => setEditing(null)}>&#x2715;</button>
                      </span>
                    ) : (
                      <button className="link" title="Editar preco medio" onClick={() => { setEditing(r.symbol); setText(r.source === "manual" && r.avg ? String(r.avg) : ""); }}>
                        {r.avg !== null ? `$${pxFmt(r.avg)}` : "informar"}
                        {r.source && <span className="muted small"> {r.source === "manual" ? "digitado" : "auto"}</span>}
                      </button>
                    )}
                    {r.source === "manual" && editing !== r.symbol && (
                      <button className="link small muted" title="Voltar ao automatico" onClick={() => saveAvg(r.symbol, null)}>limpar</button>
                    )}
                  </span></td>
                  <td data-label="Lucro / prejuizo" className={r.pnl === null ? "muted" : pnlClass(r.pnl)}>
                    {r.pnl === null ? "-" : <span>{signed(r.pnl)}{r.pct !== null && <span className="small"> ({signed(r.pct, 1)}%)</span>}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nenhum token fora de stablecoins nas carteiras.</p>
      )}

      {stables.length > 0 && (
        <>
          <button className="link small" onClick={() => setShowStables(!showStables)}>
            {showStables ? "Esconder" : "Mostrar"} stablecoins (${fmt(stableTotal)})
          </button>
          {showStables && (
            <div className="table-scroll">
              <table className="holdings">
                <thead><tr><th>Stablecoin</th><th>Quantidade</th><th>Valor</th><th>Onde</th></tr></thead>
                <tbody>
                  {stables.map((r) => (
                    <tr key={r.symbol}><td><b>{r.symbol}</b></td><td>{qtyFmt(r.qty)}</td><td>${fmt(r.value)}</td><td className="muted small">{r.where.join(", ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className="muted small">
        Preco atual = valor / quantidade lidos nas carteiras. Preco medio &quot;auto&quot; vem do historico da carteira na Zerion (FIFO, so redes EVM,
        atualizado a cada 6 h); clique no preco medio para digitar o seu (vale para todas as carteiras daquele token). Lucro sem taxas.
        Perpetuos da Lighter ficam no card proprio.
      </p>
    </section>
  );
}
