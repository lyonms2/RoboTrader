"use client";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import type { AppConfig, FichaDoc, LatestDoc, WalletDoc, WalletHistoryDoc, WalletItem } from "@/lib/types";
import { allocOf } from "@/lib/positions";
import { walletTotals } from "@/lib/walletMath";
import { walletAddresses, walletKey } from "@/lib/addresses";
import { AllocationBar, HistoryLine, ProtocolBars } from "./WalletCharts";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmt(v)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const pct = (v: number, total: number) => (total > 0 ? `${fmt((v / total) * 100, 1)}%` : "-");
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const CLASS_LABEL: Record<WalletItem["cls"], string> = { stable: "Dolar (stablecoins)", BTC: "BTC", ETH: "ETH", SOL: "SOL", outro: "Outros" };
const COINS = ["BTC", "ETH", "SOL"] as const;

// Carteira on-chain lida pelo servidor (Zerion + Lighter), comparada com a exposicao alvo da estrategia
export default function WalletCard({ wallet, history, cfg, latest, user, fichas }: {
  wallet: WalletDoc | null; history: WalletHistoryDoc[]; cfg: AppConfig; latest: LatestDoc[]; user: User; fichas: FichaDoc | null;
}) {
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

  const addrs = walletAddresses(cfg);
  if (!addrs.length)
    return (
      <section className="card">
        <h2>Carteira on-chain</h2>
        <p className="muted small">Informe os enderecos publicos das suas carteiras (EVM 0x... da Rabby/Phantom e Solana da Phantom) na Configuracao (engrenagem) para ver saldos, posicoes DeFi e perpetuos aqui. So leitura: nada e movimentado.</p>
      </section>
    );

  const head = (
    <div className="row between wrap-row">
      <h2>Carteira on-chain <span className="muted small">{addrs.map(short).join(" + ")}</span></h2>
      <button className="ghost" onClick={refresh} disabled={busy}>{busy ? "Lendo..." : "Atualizar carteira"}</button>
    </div>
  );
  if (!wallet || wallet.address !== walletKey(addrs))
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
  const { byClass, perpExpo } = walletTotals(wallet);
  // Blocos da carteira: nucleo (robo), satelite (rompimento), fora do sistema e dolar
  const alloc = allocOf(cfg);
  const coreTarget = COINS.reduce((s, c) => s + (latest.find((x) => x.symbol === `${c}USDT`)?.state.expo ?? 0) * (cfg.weights[`${c}USDT`] ?? 0) * cfg.capitalUsdt, 0);
  const coreReal = byClass.BTC + byClass.ETH + byClass.SOL + Object.values(perpExpo).reduce((s, v) => s + v, 0);
  const sat = (fichas?.items ?? []).filter((f) => !COINS.includes(f.symbol as (typeof COINS)[number]));
  const inSystem = (code?: string) => ["manter", "reduzir", "entrada", "entrada_metade", "tendencia", "saida"].includes(code ?? "");
  const satReal = sat.filter((f) => inSystem(f.situacao?.code)).reduce((s, f) => s + f.held, 0);
  const satTarget = sat.reduce((s, f) => s + (f.target ?? 0), 0);
  const outside = Math.max(0, byClass.outro - satReal);
  const blocks = [
    { name: "Nucleo", hint: "BTC/ETH/SOL pelo robo", target: coreTarget, real: coreReal },
    { name: "Satelite", hint: "rompimento 55/20", target: alloc.satellite > 0 ? satTarget : 0, real: satReal },
    { name: "Fora do sistema", hint: "outros tokens", target: 0, real: outside },
    { name: "Dolar", hint: "stablecoins rendendo", target: null as number | null, real: byClass.stable },
  ];
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
          <span className="muted small">Nucleo do robo ({fmt(alloc.core * 100, 0)}%)</span>
          <b>{fmt(cfg.capitalUsdt)} USDT</b>
          {!cfg.capitalFromWallet && (
            <button className="ghost small-btn" title="O capital passa a ser o patrimonio das carteiras"
              onClick={() => setDoc(doc(db(), "config/main"), { capitalFromWallet: true }, { merge: true })}>
              Usar patrimonio da carteira
            </button>
          )}
        </div>
      </div>

      <h3>Alocacao: real x alvo</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Bloco</th><th>Alvo</th><th>Real</th><th>Diferenca</th></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.name}>
                <td>{b.name} <span className="muted small">{b.hint}</span></td>
                <td>{b.target === null ? "-" : `${fmt(b.target)} (${pct(b.target, total)})`}</td>
                <td>{fmt(b.real)} ({pct(b.real, total)})</td>
                <td className={b.target !== null && Math.abs(b.real - b.target) > Math.max(5, 0.1 * total) ? "warn" : "muted"}>
                  {b.target === null ? "-" : signed(b.real - b.target)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Alvo do nucleo = exposicao do robo x peso x {fmt(alloc.core * 100, 0)}% do patrimonio; satelite = soma dos alvos das fichas
        (ate 5 tokens, {fmt(alloc.satellite * 100, 0)}% do patrimonio); o resto fica em dolar rendendo. &quot;Fora do sistema&quot; =
        tokens que nenhuma regra mandou comprar. Mude a divisao na Configuracao.
      </p>

      <AllocationBar byClass={byClass} />
      <div className="viz-grid">
        <ProtocolBars rows={appRows} total={total} />
        <HistoryLine history={history} />
      </div>

      <h3>Estrategia x carteira</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Moeda</th><th>Alvo da estrategia</th><th>Na carteira</th><th>Diferenca</th></tr></thead>
          <tbody>
            {COINS.map((c) => {
              const l = latest.find((x) => x.symbol === `${c}USDT`);
              const target = l ? l.state.expo * (cfg.weights[`${c}USDT`] ?? 0) * cfg.capitalUsdt : 0;
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
      <p className="muted small">Lida {new Date(wallet.at).toLocaleString("pt-BR")} (EVM: Zerion + Lighter; Solana: RPC publica + Jupiter; so leitura). O agendador atualiza a cada 30 min. Na Solana entram so os tokens na carteira (posicoes em protocolos DeFi da Solana nao aparecem).</p>
      {msg && <p className="error small">{msg}</p>}
    </section>
  );
}
