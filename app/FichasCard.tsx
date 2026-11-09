"use client";
import { Fragment, useState } from "react";
import type { FichaDoc, TokenFicha } from "@/lib/types";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// Valores grandes abreviados (mi = milhoes, bi = bilhoes)
const big = (v: number | null) =>
  v === null ? "-" : v >= 1e9 ? `$${fmt(v / 1e9, 1)} bi` : v >= 1e6 ? `$${fmt(v / 1e6, 1)} mi` : v >= 1e3 ? `$${fmt(v / 1e3, 0)} mil` : `$${fmt(v, 0)}`;
const pct = (v: number | null, d = 0) => (v === null ? "-" : Math.abs(v) < 0.5 ? "0%" : `${v > 0 ? "+" : ""}${fmt(v, d)}%`);

const USES = [
  ["entrada", "Antes de comprar (com metade ou não entre)"],
  ["saida", "Se estiver exposto (reduzir)"],
  ["olho", "Para ficar de olho"],
] as const;

// Fichas dos tokens (fora do grafico): oferta, avaliacao e receita, com alertas de risco
export default function FichasCard({ fichas }: { fichas: FichaDoc | null }) {
  const [open, setOpen] = useState<string | null>(null);

  const rows = fichas?.items ?? [];
  const warnCount = (f: TokenFicha) => f.alerts.filter((a) => a.level === "warn").length;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Fichas dos tokens</h2>
        {fichas && <span className="muted small">atualizadas {new Date(fichas.at).toLocaleString("pt-BR")}</span>}
      </div>
      {!fichas ? (
        <p className="muted">Ainda não montadas. Clique em &quot;Atualizar&quot; (no alto desta página).</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="fichas stack">
              <thead>
                <tr>
                  <th>Token</th><th>Situação</th><th>Valor de mercado</th><th title="Valor totalmente diluído / valor de mercado">FDV / mercado</th>
                  <th title="Oferta em circulação / máxima">Circulando</th><th>Receita 30 dias</th>
                  <th title="Valor de mercado / receita anualizada">Preço / receita</th><th>30 dias</th><th>Alertas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <Fragment key={f.id}>
                    <tr className="clickable" onClick={() => setOpen(open === f.id ? null : f.id)}>
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.image} alt="" width={16} height={16} className="coin" />
                        <b>{f.symbol}</b> <span className="muted small">#{f.rank ?? "-"}</span>
                      </td>
                      <td data-label="Situação"><div className="cell">
                        {f.situacao ? <span className={`sit sit-${f.situacao.code}`} title={f.situacao.detail}>{f.situacao.label}</span> : <span className="muted small">-</span>}
                        {f.action && <div className="small action-line">{f.action}</div>}
                        {f.held >= 1 && <div className="small muted">você tem ${fmt(f.held, 0)}{f.target !== null ? ` / alvo $${fmt(f.target, 0)}` : ""}</div>}
                      </div></td>
                      <td data-label="Valor de mercado">{big(f.mcap)}</td>
                      <td data-label="FDV / mercado" className={f.fdv && f.mcap && f.fdv / f.mcap >= 2 ? "warn" : ""}>{f.fdv && f.mcap ? `${fmt(f.fdv / f.mcap, 1)}x` : "-"}</td>
                      <td data-label="Circulando">{f.circPct === null ? "-" : `${fmt(f.circPct * 100, 0)}%`}</td>
                      <td data-label="Receita 30 dias"><span>{big(f.revenue30d)}{f.kind === "rede" && f.revenue30d !== null ? <span className="muted small"> taxas</span> : ""}</span></td>
                      <td data-label="Preço / receita">{f.pf === null ? "-" : `${fmt(f.pf, 0)}x`}</td>
                      <td data-label="30 dias" className={f.change30d === null ? "" : f.change30d >= 0 ? "pos" : "neg"}>{pct(f.change30d)}</td>
                      <td data-label="Alertas"><span>
                        {warnCount(f) > 0 ? <span className="chip warn-chip">{warnCount(f)} atenção</span> : null}
                        {f.alerts.length - warnCount(f) > 0 ? <span className="chip">{f.alerts.length - warnCount(f)} info</span> : null}
                        {!f.alerts.length ? <span className="muted small">-</span> : null}
                      </span></td>
                    </tr>
                    {open === f.id && (
                      <tr className="detail">
                        <td colSpan={9}>
                          <b>{f.name}</b> - preço ${fmt(f.price, f.price < 1 ? 6 : 2)}, volume 24h {big(f.volume)},
                          {" "}{f.athDrop === null ? "" : `${fmt(-f.athDrop, 0)}% abaixo da máxima histórica`}
                          {f.revenuePrev30d ? `, receita do mês anterior ${big(f.revenuePrev30d)}` : ""}.
                          {f.situacao && <p className="sit-detail"><span className={`sit sit-${f.situacao.code}`}>{f.situacao.label}</span> {f.situacao.detail}</p>}
                          {USES.map(([use, title]) => {
                            const list = f.alerts.filter((a) => (a.use ?? ["olho"]).includes(use));
                            return list.length ? (
                              <div key={use} className="alert-group">
                                <span className="small muted">{title}</span>
                                <ul className="alerts">{list.map((a) => <li key={a.text} className={a.level === "warn" ? "warn" : "muted"}>{a.text}</li>)}</ul>
                              </div>
                            ) : null;
                          })}
                          {!f.alerts.length && <p className="muted small">Nenhum alerta.</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {fichas.missing.length > 0 && <p className="muted small">Não encontrados na CoinGecko: {fichas.missing.join(", ")}.</p>}
          {fichas.errors.map((e) => <p key={e} className="error small">{e}</p>)}
          <p className="muted small">
            Situação: BTC, ETH e SOL seguem o robô; os outros tokens, o rompimento 55/20 (entra ao fechar na máxima de 55 dias com o
            BTC em alta, sai ao fechar na mínima de 20 dias). &quot;Com metade&quot; quando há alerta de entrada; &quot;Reduzir&quot; quando você
            tem o token e aparece alerta de saída. Os alertas sozinhos não mandam comprar: no backtest não melhoraram o momento.
            Operar só em carteira própria (DEX); a Binance é usada apenas como fonte de preços.
            Fontes: Binance (só preços), CoinGecko e DefiLlama, gratuitas. Clique numa linha para ver os detalhes.
          </p>
        </>
      )}
    </section>
  );
}
