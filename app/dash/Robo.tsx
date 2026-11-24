"use client";
import { performance } from "@/lib/performance";
import { DEFAULT_PARAMS, decide } from "@/lib/strategy";
import { health, referenceOf } from "@/lib/robotStats";
import { type AppConfig, type LatestDoc, type TradeDoc } from "@/lib/types";
import Chart from "../Chart";
import PerfChart from "../PerfChart";
import { type Prices } from "../usePrices";
import Note from "../Note";
import { ago, currentPrice, day, fmt, fmtPx, fmtQty, openPnl, pnlClass, signed } from "./util";

// Seu resultado real x a estrategia seguida a risca, desde a primeira operacao registrada
export function Performance({ cfg, latest, trades, prices }: { cfg: AppConfig; latest: LatestDoc[]; trades: TradeDoc[]; prices: Prices }) {
  if (!trades.length) return null;
  const perf = performance(cfg, latest, trades, prices.values);
  if (!perf)
    return (
      <section className="card">
        <h2>Real x estratégia</h2>
        <p className="muted small">Em Cripto, clique em &quot;Atualizar&quot; para carregar a série da estratégia.</p>
      </section>
    );
  const last = perf.points[perf.points.length - 1];
  const diff = last.real - last.strat;
  const pctOf = (v: number) => (perf.capital > 0 ? ` (${signed((v / perf.capital) * 100, 1)}%)` : "");
  return (
    <section className="card">
      <div className="card-head"><h2>Real x estratégia</h2><span className="muted small">desde {day(perf.start)}</span></div>
      <div className="summary perf">
        <div><span className="muted small">Seu resultado</span><b className={pnlClass(last.real)}>{signed(last.real)} USDT{pctOf(last.real)}</b></div>
        <div><span className="muted small">Estratégia a risca</span><b className={pnlClass(last.strat)}>{signed(last.strat)} USDT{pctOf(last.strat)}</b></div>
        <div><span className="muted small">Diferença</span><b className={pnlClass(diff)}>{signed(diff)} USDT</b></div>
      </div>
      <PerfChart points={perf.points} />
      <p className="legend small"><i className="k-real" /> seu resultado <i className="k-strat" /> estratégia a risca</p>
      <Note>
        A estratégia usa o capital configurado de cada moeda ({fmt(perf.capital)} USDT) e opera no fechamento das 21:00.
        A diferença mostra atraso, preço e tamanho diferentes dos sinais. Sem taxas e funding nos dois.
        {perf.clipped ? " As operações mais antigas que o gráfico (240 dias) entram no primeiro dia." : ""}
      </Note>
    </section>
  );
}

export const EVENT_LABEL = { entrada: "Compra", reentrada: "Reentrada", cheia: "Posição cheia", meia: "Reduz a metade", saida: "Venda" } as const;
export const pctFmt = (v: number, d = 1) => `${v > 0 ? "+" : ""}${fmt(v * 100, d)}%`;
// Preco de referencia com 2 casas (ou mais para moedas baratas): so para leitura, nao e quantidade
export const refPx = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v >= 100 ? 2 : 4 });

// Card de uma moeda do robo: sinal oficial, previa, regras de saida/entrada, grafico e resultados com a saude da estrategia
export function AssetCard({ l, cfg, prices, study }: { l: LatestDoc; cfg: AppConfig; prices: Prices; study?: boolean }) {
  const s = l.state;
  const params = { ...DEFAULT_PARAMS, reentry: cfg.reentry };
  const cur = currentPrice(l, prices);
  const pnl = openPnl(cfg, l.symbol, cur.price);
  const avg = cfg.avgPrice?.[l.symbol] ?? 0;
  const coin = l.symbol.replace("USDT", "");
  const capital = cfg.capitalUsdt * (cfg.weights[l.symbol] ?? 0);
  const pos = cfg.positions[l.symbol] ?? 0;
  const d = decide(s, capital, pos, params);
  const tone = d.kind === "VENDER_TUDO" || d.kind === "VENDER_PARTE" ? "sell" : d.qty > 0 ? "buy" : "hold";
  const buf = DEFAULT_PARAMS.bufferPct / 100;
  const ps = l.preview?.state;
  const pd = ps ? decide(ps, capital, pos, params) : null;
  const closeAt = s.t + 86_400_000; // o candle fecha 24 h depois de abrir (00:00 UTC = 21:00 de Brasilia)
  const when = new Date(closeAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const sma = s.sma ?? 0;
  const dist = (lvl: number) => (cur.price > 0 ? pctFmt(lvl / cur.price - 1) : "");
  const inMarket = s.expo > 0;
  const stats = l.stats ?? null;
  const ref = referenceOf(l.symbol, cfg.reentry);
  const h = stats ? health(stats, ref) : null;

  return (
    <section className="card asset">
      <div className="card-head">
        <h2>{coin} <span className="muted small">{inMarket ? `comprado ${fmt(s.expo * 100, 0)}% da fatia` : "fora do mercado"}</span></h2>
        <div className="price-now"><b>{fmtPx(cur.price)}</b><span className="muted small">{cur.live ? "ao vivo" : `recálculo ${ago(cur.at)}`}</span></div>
      </div>

      {study ? (
        <div className="signal hold">
          <span className="signal-tag">Estudo - fechamento de {when}</span>
          <b>{inMarket ? "Pela regra, estaria comprado" : "Pela regra, estaria fora"}</b>
        </div>
      ) : (
      <div className={`signal ${tone}`}>
        <span className="signal-tag">Sinal oficial - fechamento de {when} - vale até o próximo fechamento</span>
        <b>{d.label}</b>
        {d.qty > 0 && <span>{fmtQty(d.qty)} {coin} (~${fmt(d.qty * s.close)})</span>}
      </div>
      )}
      {!study && pd && ps && (
        <div className={`preview-box ${pd.kind !== d.kind ? "changes" : ""}`}>
          <span className="signal-tag">Prévia (não é sinal) - se o candle de hoje fechasse agora a {fmtPx(ps.close)}</span>
          {pd.kind !== d.kind ? <b>{pd.label}</b> : <span className="muted">sem mudança</span>}
        </div>
      )}

      {!study && pos > 0 && (
        <div className="pos-row">
          <span>Sua posição: <b>{fmtQty(pos)} {coin}</b> (~${fmt(pos * cur.price)})</span>
          <span className={pnlClass(pnl.usdt)}>{avg > 0 ? `${signed(pnl.usdt)} (${signed(pnl.pct, 1)}%)` : <span className="muted">sem preço médio</span>}</span>
        </div>
      )}

      <div className="rules">
        <span className="small muted">{inMarket ? "Saídas (qualquer uma vale, no fechamento):" : "Para entrar (no fechamento):"}</span>
        <ul>
          {inMarket ? (
            <>
              <li><span>Fechar abaixo da SMA 150 - 2%</span><b>{refPx(sma * (1 - buf))}</b><i className="muted small">{dist(sma * (1 - buf))}</i></li>
              <li><span>HMA 100 virar para baixo</span><b className={s.hmaDown ? "warn" : "pos"}>{s.hmaDown ? "caindo" : "subindo"}</b><i /></li>
              {s.stop !== null && <li><span>Fechar abaixo do stop da reentrada</span><b>{refPx(s.stop)}</b><i className="muted small">{dist(s.stop)}</i></li>}
            </>
          ) : (
            <>
              <li><span>Fechar acima da SMA 150 + 2%</span><b>{refPx(sma * (1 + buf))}</b><i className="muted small">{dist(sma * (1 + buf))}</i></li>
              <li><span>e a HMA 100 subindo</span><b className={s.hmaDown ? "warn" : "pos"}>{s.hmaDown ? "caindo" : "subindo"}</b><i /></li>
              {cfg.reentry && <li><span>ou repique na SMA (meia posição)</span><b>{refPx(sma)}</b><i className="muted small">{dist(sma)}</i></li>}
            </>
          )}
        </ul>
      </div>

      <Chart chart={l.chart} />
      <p className="legend small"><i className="k-close" /> preço <i className="k-sma" /> SMA {DEFAULT_PARAMS.sma} <i className="k-hma" /> HMA {DEFAULT_PARAMS.hma} <i className="k-band" /> comprado</p>

      {stats && h && (
        <div className="results">
          <div className="card-head">
            <h3>Resultados do robô</h3>
            <span className={`health health-${h.level}`}>{h.label}</span>
          </div>
          {h.reasons.length > 0 && <ul className="alerts small">{h.reasons.map((r) => <li key={r} className={h.level === "bad" ? "error" : "warn"}>{r}</li>)}</ul>}
          <div className="stat-grid">
            <div><span>Robô</span><b className={pnlClass(stats.totalRet)}>{pctFmt(stats.totalRet, 0)}</b><small>só segurar {pctFmt(stats.bhRet, 0)}</small></div>
            <div><span>Pior queda</span><b>{pctFmt(stats.mdd, 0)}</b><small>só segurar {pctFmt(stats.bhMdd, 0)}{ref ? ` - teste ${pctFmt(ref.mdd, 0)}` : ""}</small></div>
            <div><span>Queda agora</span><b className={stats.curDD < -0.1 ? "warn" : ""}>{pctFmt(stats.curDD, 0)}</b><small>{stats.daysUnderwater} dias sem novo pico</small></div>
            <div><span>12 meses</span><b className={pnlClass(stats.last12?.strat ?? 0)}>{stats.last12 ? pctFmt(stats.last12.strat, 0) : "-"}</b>
              <small>{stats.last12 ? `só segurar ${pctFmt(stats.last12.bh, 0)}` : ""}</small></div>
            <div><span>Trades</span><b>{stats.count}</b><small>acerto {fmt(stats.win * 100, 0)}%{ref ? ` (teste ${fmt(ref.win * 100, 0)}%)` : ""}</small></div>
            <div><span>Ganho / perda média</span><b>{pctFmt(stats.avgWin, 0)} / {pctFmt(stats.avgLoss, 1)}</b>
              <small>perdas seguidas: {stats.streakNow} (max {stats.streakMax}{ref ? `, teste ${ref.streak}` : ""})</small></div>
          </div>
          <ul className="events trades">
            {stats.trades.slice(0, 6).map((t) => (
              <li key={t.entry}>
                <div className="ev-top">
                  <span className="muted">{day(t.entry)} - {t.exit ? day(t.exit) : "aberto"}</span>
                  <span className="muted small">{t.days} dias</span>
                  <span className={`ev-ret ${pnlClass(t.ret)}`}>{pctFmt(t.ret)}</span>
                </div>
              </li>
            ))}
          </ul>
          <Note>
            Desde {day(stats.since)} ({fmt(stats.years, 1)} anos de gráficos disponíveis), seguindo o robô a risca com a fatia cheia, a vista e 0,1% de taxa.
            &quot;Teste&quot; = backtest até 07/2024. A estratégia para de fazer sentido se a queda ou as perdas seguidas passarem bem do teste.
          </Note>
        </div>
      )}

      <details className="history">
        <summary className="small">Detalhes e histórico de sinais ({l.events?.length ?? 0})</summary>
        <dl>
          <dt>Fechamento do candle</dt><dd>{fmtPx(s.close)}</dd>
          <dt>SMA {DEFAULT_PARAMS.sma}</dt><dd>{fmtPx(sma)} ({fmt(((s.close / (sma || s.close)) - 1) * 100, 1)}%)</dd>
          <dt>HMA {DEFAULT_PARAMS.hma}</dt><dd className={s.hmaDown ? "warn" : ""}>{s.hmaDown ? "caindo" : "subindo"}{s.turnDown ? " (virou hoje)" : ""}</dd>
          <dt>Volatilidade 30d</dt><dd>{fmt((s.vol ?? 0) * 100, 0)}% ao ano</dd>
          <dt>Exposição alvo</dt><dd>{fmt(s.expo * 100, 0)}% = {fmtQty(d.targetQty)} {coin}</dd>
          <dt>Fatia do robô</dt><dd>${fmt(capital)}</dd>
        </dl>
        {l.events?.length ? (
          <ul className="events">
            {[...l.events].reverse().map((e) => (
              <li key={e.t}>
                <div className="ev-top">
                  <span className="muted">{day(e.t)}</span>
                  <b className={e.kind === "saida" || e.kind === "meia" ? "neg" : "pos"}>{EVENT_LABEL[e.kind]}</b>
                  <span>{fmtPx(e.price)}</span>
                  {e.ret !== null && <span className={`ev-ret ${pnlClass(e.ret)}`}>{signed(e.ret * 100, 1)}%</span>}
                </div>
                <div className="muted small">{e.reason}</div>
              </li>
            ))}
          </ul>
        ) : null}
        <Note>% na venda = variação do preço desde a entrada (sem o tamanho da posição).</Note>
      </details>
    </section>
  );
}
