"use client";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import type { AppConfig, WalletDoc } from "@/lib/types";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const qtyFmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: v >= 1 ? 4 : 8 });
// Preco com casas suficientes para tokens baratos
const pxFmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v >= 1 ? 2 : v >= 0.01 ? 4 : 8 });
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${fmt(v, d)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

type Row = {
  symbol: string; name: string; qty: number; value: number; price: number; where: string[]; stable: boolean;
  avg: number | null; source: "manual" | "Zerion" | null; cost: number | null; pnl: number | null; pct: number | null;
};

// Junta o mesmo token de varias carteiras, redes e protocolos e calcula preco medio e lucro
export function holdings(wallet: WalletDoc, costBasis: Record<string, number> = {}): Row[] {
  const groups = new Map<string, Row & { ids: Set<string> }>();
  for (const i of wallet.items) {
    if (i.type === "loan" || i.type === "reward") continue;
    const key = i.symbol.toUpperCase();
    const g = groups.get(key) ?? {
      symbol: i.symbol, name: i.name, qty: 0, value: 0, price: 0, where: [], stable: i.cls === "stable",
      avg: null, source: null, cost: null, pnl: null, pct: null, ids: new Set<string>(),
    };
    g.qty += i.qty;
    g.value += i.value;
    const where = i.app === "Carteira" || i.app === "Carteira Solana" ? i.chain : `${i.app}${i.type !== "wallet" ? ` (${i.type})` : ""}`;
    if (where && !g.where.includes(where)) g.where.push(where);
    if (i.fungibleId) g.ids.add(i.fungibleId);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ ids, ...g }) => {
    g.price = g.qty > 0 ? g.value / g.qty : 0;
    const manual = costBasis[g.symbol.toUpperCase()];
    const invested = [...ids].reduce((s, id) => s + (wallet.pnl?.[id]?.netInvested ?? 0), 0);
    if (manual > 0) [g.avg, g.source] = [manual, "manual"];
    else if (invested > 0 && g.qty > 0) [g.avg, g.source] = [invested / g.qty, "Zerion"];
    if (g.avg !== null) {
      g.cost = g.avg * g.qty;
      g.pnl = g.value - g.cost;
      g.pct = g.cost > 0 ? (g.pnl / g.cost) * 100 : null;
    }
    return g;
  }).sort((a, b) => b.value - a.value);
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
  const known = tokens.filter((r) => r.cost !== null);
  const cost = known.reduce((s, r) => s + (r.cost ?? 0), 0);
  const pnl = known.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const stableTotal = stables.reduce((s, r) => s + r.value, 0);

  async function saveAvg(symbol: string, value: number | null) {
    const key = symbol.toUpperCase();
    const next = { ...(cfg.costBasis ?? {}) };
    if (value && value > 0) next[key] = value;
    else delete next[key];
    await setDoc(doc(db(), "config/main"), { costBasis: next }, { merge: true });
    setEditing(null);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Meus tokens</h2>
        <span className="muted small">precos de {new Date(wallet.at).toLocaleString("pt-BR")}</span>
      </div>
      <div className="kpis">
        <div><span>Em tokens</span><b>${fmt(tokens.reduce((s, r) => s + r.value, 0))}</b><small className="muted">{tokens.length} tokens</small></div>
        <div><span>Custo (com preco medio)</span><b>${fmt(cost)}</b><small className="muted">{known.length} de {tokens.length} tokens</small></div>
        <div><span>Lucro / prejuizo</span><b className={pnlClass(pnl)}>{signed(pnl)}</b>
          <small className="muted">{cost > 0 ? `${signed((pnl / cost) * 100, 1)}%` : "informe os precos medios"}</small></div>
        <div><span>Em dolar</span><b>${fmt(stableTotal)}</b><small className="muted">{stables.length} stablecoins</small></div>
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
