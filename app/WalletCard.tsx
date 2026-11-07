"use client";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import type { AppConfig, LatestDoc, WalletDoc, WalletItem } from "@/lib/types";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmt(v)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const pct = (v: number, total: number) => (total > 0 ? `${fmt((v / total) * 100, 1)}%` : "-");
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const CLASS_LABEL: Record<WalletItem["cls"], string> = { stable: "Dolar (stablecoins)", BTC: "BTC", ETH: "ETH", SOL: "SOL", outro: "Outros" };
const COINS = ["BTC", "ETH", "SOL"] as const;

// Carteira on-chain lida pelo servidor (Zerion + Lighter), comparada com a exposicao alvo da estrategia
export default function WalletCard({ wallet, cfg, latest, user }: { wallet: WalletDoc | null; cfg: AppConfig; latest: LatestDoc[]; user: User }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/wallet", { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      const text = await res.text();
      let body: { error?: string; reason?: string; skipped?: boolean } = {};
      try { body = JSON.parse(text); } catch { /* nao e JSON */ }
      if (!res.ok) setMsg(`Falhou (HTTP ${res.status}): ${body.error ?? (text.slice(0, 200) || "(resposta vazia)")}`);
      else if (body.skipped) setMsg(`Nada atualizado: ${body.reason}.`);
    } catch (e) {
      setMsg(`Falhou: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!cfg.wallet)
    return (
      <section className="card">
        <h2>Carteira on-chain</h2>
        <p className="muted small">Informe o endereco publico (0x...) da sua carteira na Configuracao (engrenagem) para ver saldos, posicoes DeFi e perpetuos da Lighter aqui. So leitura: nada e movimentado.</p>
      </section>
    );

  const head = (
    <div className="row between wrap-row">
      <h2>Carteira on-chain <span className="muted small">{short(cfg.wallet)}</span></h2>
      <button className="ghost" onClick={refresh} disabled={busy}>{busy ? "Lendo..." : "Atualizar carteira"}</button>
    </div>
  );
  if (!wallet || wallet.address.toLowerCase() !== cfg.wallet.toLowerCase())
    return (
      <section className="card">
        {head}
        <p className="muted small">Ainda nao lida. Clique em &quot;Atualizar carteira&quot;.</p>
        {msg && <p className="error small">{msg}</p>}
      </section>
    );

  const total = wallet.total;
  const lt = wallet.lighter;
  // Exposicao real por moeda: saldo a vista + perpetuos (comprado soma, vendido subtrai)
  const byClass: Record<WalletItem["cls"], number> = { stable: 0, BTC: 0, ETH: 0, SOL: 0, outro: 0 };
  for (const i of wallet.items) byClass[i.cls] += i.value;
  const perpExpo: Record<string, number> = {};
  for (const p of lt?.perps ?? []) perpExpo[p.symbol] = (perpExpo[p.symbol] ?? 0) + (p.side === "long" ? 1 : -1) * p.notional;
  if (lt) byClass.stable += lt.value; // margem da Lighter e USDC
  const perpNotional = (lt?.perps ?? []).reduce((s, p) => s + p.notional, 0);
  const lev = lt && lt.value > 0 ? perpNotional / lt.value : 0;
  const totalLev = total > 0 ? (byClass.BTC + byClass.ETH + byClass.SOL + byClass.outro + perpNotional) / total : 0;

  // Agrupa por protocolo
  const apps = new Map<string, WalletItem[]>();
  for (const i of [...wallet.items].sort((a, b) => b.value - a.value)) apps.set(i.app, [...(apps.get(i.app) ?? []), i]);
  const appRows = [...apps.entries()].map(([app, list]) => ({ app, list, value: list.reduce((s, i) => s + i.value, 0) }));
  if (lt) appRows.push({ app: "Lighter (perpetuos)", list: [], value: lt.value });
  appRows.sort((a, b) => b.value - a.value);

  const soon = wallet.items.filter((i) => i.maturity !== null).map((i) => ({ ...i, days: Math.ceil((i.maturity! - Date.now()) / 86_400_000) }));
  const rewards = wallet.items.filter((i) => i.type === "reward");

  return (
    <section className="card">
      {head}
      <div className="summary perf">
        <div><span className="muted small">Patrimonio na carteira</span><b>{fmt(total)} USD</b></div>
        <div><span className="muted small">Em dolar (stablecoins)</span><b>{fmt(byClass.stable)} ({pct(byClass.stable, total)})</b></div>
        <div><span className="muted small">Exposicao a cripto</span><b>{fmt((totalLev) * 100, 1)}% do patrimonio</b></div>
        <div>
          <span className="muted small">Capital da estrategia</span>
          <b>{fmt(cfg.capitalUsdt)} USDT</b>
          {Math.abs(cfg.capitalUsdt - total) > 1 && (
            <button className="ghost small-btn" onClick={() => setDoc(doc(db(), "config/main"), { capitalUsdt: Math.round(total * 100) / 100 }, { merge: true })}>
              Usar {fmt(total)}
            </button>
          )}
        </div>
      </div>

      <h3>Estrategia x carteira</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Moeda</th><th>Alvo da estrategia</th><th>Na carteira</th><th>Diferenca</th></tr></thead>
          <tbody>
            {COINS.map((c) => {
              const l = latest.find((x) => x.symbol === `${c}USDT`);
              const target = l ? l.state.expo * (cfg.weights[`${c}USDT`] ?? 0) * total : 0;
              const real = byClass[c] + (perpExpo[c] ?? 0);
              const diff = real - target;
              return (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{l ? `${fmt(target)} (${pct(target, total)})` : "-"}</td>
                  <td>{fmt(real)} ({pct(real, total)})</td>
                  <td className={Math.abs(diff) > Math.max(5, target * 0.25) ? "warn" : "muted"}>{signed(diff)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Alvo = exposicao alvo do ultimo fechamento x peso da moeda x patrimonio da carteira. Inclui saldo a vista e perpetuos.</p>

      {(lev > 1.01 || soon.length > 0 || rewards.length > 0 || wallet.errors.length > 0) && (
        <ul className="alerts small">
          {lev > 1.01 && <li className="warn">Lighter com alavancagem efetiva de {fmt(lev, 2)}x sobre a margem (a estrategia usa 1x).</li>}
          {soon.map((i) => (
            <li key={`${i.app}${i.symbol}`} className={i.days <= 14 ? "warn" : ""}>
              {i.symbol} ({i.app}) {i.days > 0 ? `vence em ${i.days} dias` : "ja venceu: resgate"} - {fmt(i.value)} USD.
            </li>
          ))}
          {rewards.map((i) => <li key={`r${i.app}${i.symbol}`}>Recompensa para resgatar: {fmt(i.qty, 4)} {i.symbol} ({i.app}, {fmt(i.value)} USD).</li>)}
          {wallet.errors.map((e) => <li key={e} className="error">{e}</li>)}
        </ul>
      )}

      {lt && lt.perps.length > 0 && (
        <>
          <h3>Perpetuos (Lighter)</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Par</th><th>Lado</th><th>Tamanho</th><th>Entrada</th><th>Valor</th><th>Lucro/prejuizo</th></tr></thead>
              <tbody>
                {lt.perps.map((p) => (
                  <tr key={p.symbol}>
                    <td>{p.symbol}</td><td className={p.side === "long" ? "pos" : "neg"}>{p.side === "long" ? "comprado" : "vendido"}</td>
                    <td>{p.size}</td><td>{fmt(p.entry)}</td><td>{fmt(p.notional)}</td>
                    <td className={pnlClass(p.pnl)}>{signed(p.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Margem {fmt(lt.value)} USD, livre {fmt(lt.available)} USD.</p>
        </>
      )}

      <details className="history">
        <summary className="small">Onde esta o dinheiro ({appRows.length} lugares)</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Protocolo</th><th>Ativos</th><th>Valor (USD)</th><th>%</th></tr></thead>
            <tbody>
              {appRows.map((r) => (
                <tr key={r.app}>
                  <td>{r.app}</td>
                  <td className="muted">{r.list.slice(0, 6).map((i) => `${i.symbol}${i.type !== "wallet" ? ` (${i.type})` : ""}`).join(", ") || "margem USDC"}</td>
                  <td>{fmt(r.value)}</td><td>{pct(r.value, total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Por classe: {(Object.keys(byClass) as WalletItem["cls"][]).filter((k) => Math.abs(byClass[k]) >= 0.01).map((k) => `${CLASS_LABEL[k]} ${pct(byClass[k], total)}`).join(" | ")}</p>
      </details>
      <p className="muted small">Lida {new Date(wallet.at).toLocaleString("pt-BR")} (Zerion + Lighter, so leitura). O agendador atualiza no maximo 1 vez por hora.</p>
      {msg && <p className="error small">{msg}</p>}
    </section>
  );
}
