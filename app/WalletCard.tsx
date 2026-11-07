"use client";
import type { AppConfig, LatestDoc, WalletDoc, WalletHistoryDoc, WalletItem } from "@/lib/types";
import { walletNotices } from "@/lib/allocation";
import { walletTotals } from "@/lib/walletMath";
import { walletAddresses, walletKey } from "@/lib/addresses";
import { AllocationBar, HistoryLine, ProtocolBars } from "./WalletCharts";
import HoldingsCard from "./HoldingsCard";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmt(v)}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const pct = (v: number, total: number) => (total > 0 ? `${fmt((v / total) * 100, 1)}%` : "-");
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const COINS = ["BTC", "ETH", "SOL"] as const;

// Carteiras on-chain lidas pelo servidor (EVM: Zerion + Lighter; Solana: RPC + Jupiter). So leitura.
export default function WalletCard({ wallet, history, cfg, latest }: {
  wallet: WalletDoc | null; history: WalletHistoryDoc[]; cfg: AppConfig; latest: LatestDoc[];
}) {
  const addrs = walletAddresses(cfg);
  if (!addrs.length)
    return (
      <section className="card empty">
        <h2>Carteiras</h2>
        <p className="muted">Cadastre os enderecos publicos das suas carteiras (Rabby / Phantom) na Configuracao para ver saldos,
          posicoes DeFi e a alocacao aqui. So leitura: nada e movimentado.</p>
      </section>
    );
  if (!wallet || wallet.address !== walletKey(addrs))
    return (
      <section className="card empty">
        <h2>Carteiras</h2>
        <p className="muted">Ainda nao lidas. Clique em &quot;Atualizar tudo&quot;.</p>
      </section>
    );

  const total = wallet.total;
  const lt = wallet.lighter;
  const { byClass, perpExpo } = walletTotals(wallet);
  const apps = new Map<string, WalletItem[]>();
  for (const i of [...wallet.items].sort((a, b) => b.value - a.value)) apps.set(i.app, [...(apps.get(i.app) ?? []), i]);
  const appRows = [...apps.entries()].map(([app, list]) => ({ app, list, value: list.reduce((s, i) => s + i.value, 0) }));
  if (lt) appRows.push({ app: "Lighter (perpetuos)", list: [], value: lt.value });
  appRows.sort((a, b) => b.value - a.value);
  const notices = walletNotices(wallet);

  return (
    <>
      <HoldingsCard wallet={wallet} cfg={cfg} />
      <section className="card">
        <div className="card-head">
          <h2>Patrimonio</h2>
          <span className="muted small">{addrs.map(short).join(" + ")}</span>
        </div>
        <div className="kpis">
          <div><span>Total</span><b>${fmt(total)}</b></div>
          <div><span>Em dolar</span><b>${fmt(byClass.stable)} <small>{pct(byClass.stable, total)}</small></b></div>
          <div><span>Em cripto</span><b>${fmt(total - byClass.stable)} <small>{pct(total - byClass.stable, total)}</small></b></div>
        </div>
        <AllocationBar byClass={byClass} />
        <div className="viz-grid">
          <ProtocolBars rows={appRows} total={total} />
          <HistoryLine history={history} />
        </div>
        {notices.length > 0 && (
          <ul className="alerts small">
            {notices.map((n) => <li key={n.text} className={n.level === "info" ? "muted" : n.level}>{n.text}</li>)}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Robo x carteira</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Moeda</th><th>Alvo do robo</th><th>Na carteira</th><th>Diferenca</th></tr></thead>
            <tbody>
              {COINS.map((c) => {
                const l = latest.find((x) => x.symbol === `${c}USDT`);
                const target = l ? l.state.expo * (cfg.weights[`${c}USDT`] ?? 0) * cfg.capitalUsdt : 0;
                const real = byClass[c] + (perpExpo[c] ?? 0);
                const diff = real - target;
                return (
                  <tr key={c}>
                    <td><b>{c}</b></td>
                    <td>{l ? `$${fmt(target)}` : "-"}</td>
                    <td>${fmt(real)}</td>
                    <td className={Math.abs(diff) > Math.max(5, target * 0.25) ? "warn" : "muted"}>{signed(diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Alvo = exposicao do ultimo fechamento x peso da moeda x capital do nucleo. Inclui saldo a vista e perpetuos.</p>
      </section>

      {lt && lt.perps.length > 0 && (
        <section className="card">
          <h2>Perpetuos (Lighter)</h2>
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
          <p className="muted small">Margem ${fmt(lt.value)}, livre ${fmt(lt.available)}.</p>
        </section>
      )}

      <section className="card">
        <h2>Onde esta o dinheiro</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Protocolo</th><th>Ativos</th><th>Valor</th><th>%</th></tr></thead>
            <tbody>
              {appRows.map((r) => (
                <tr key={r.app}>
                  <td>{r.app}</td>
                  <td className="muted">{r.list.slice(0, 6).map((i) => `${i.symbol}${i.type !== "wallet" ? ` (${i.type})` : ""}`).join(", ") || "margem USDC"}</td>
                  <td>${fmt(r.value)}</td><td>{pct(r.value, total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Lida {new Date(wallet.at).toLocaleString("pt-BR")}. EVM: Zerion + Lighter; Solana: RPC publica + Jupiter (so tokens na carteira,
          sem posicoes DeFi da Solana).
        </p>
      </section>
    </>
  );
}
