"use client";
import { useMemo, useState } from "react";
import { P } from "@/lib/paths";
import { allocOf } from "@/lib/positions";
import { allocationBlocks, walletNotices } from "@/lib/allocation";
import { walletAddresses, walletKey } from "@/lib/addresses";
import { DEFAULT_PARAMS, decide } from "@/lib/strategy";
import { SYMBOLS, type AppConfig, type LatestDoc, type FichaDoc, type LighterSyncDoc, type WalletDoc } from "@/lib/types";
import { MonthAndUpcoming, NetWorthBlock, PatrimonioCard } from "../OverviewBlocks";
import type { Sub as FinSub } from "../FinanceCard";
import { reviewCount, saveSetup, upcoming, budgetAlerts } from "../gastosShared";
import { buildAlerts } from "@/lib/alerts";
import type { NetWorthDoc } from "@/lib/patrimonio";
import { monthIncomes, accountBalance, fixoActive, recvStatus, fixoReajPending, investFlows } from "@/lib/gastos";
import { financeSummary } from "@/lib/financeMath";
import { type Prices } from "../usePrices";
import Note from "../Note";
import { TabId, ago, fmt, fmtPx, fmtQty, openPnl, ordered, pnlClass, priceOf, signed } from "./util";

// Visao geral: patrimonio, o que fazer hoje, alocacao e posicoes do robo
export type Money = Parameters<typeof PatrimonioCard>[0] extends infer P ? Omit<P, "onBens"> & { nwHist: NetWorthDoc[] } : never;
// Visao geral: patrimonio, o que fazer hoje, o mes e os proximos pagamentos, evolucao e, depois, o robo e a cripto
export function Overview({ member, cfg, latest, prices, wallet, fichas, sync, onTab, money, onFin }: {
  member?: boolean; cfg: AppConfig; latest: LatestDoc[]; prices: Prices; wallet: WalletDoc | null; fichas: FichaDoc | null;
  sync: LighterSyncDoc | null; onTab: (t: TabId) => void; money: Money; onFin: (s: FinSub | "loans" | "recv") => void;
}) {
  const params = { ...DEFAULT_PARAMS, reentry: cfg.reentry };
  const [allTodo, setAllTodo] = useState(false);
  // Posicoes do robo e lucro aberto
  let open = 0;
  let invested = 0;
  let unknown = false;
  const rows: { symbol: string; pos: number; avg: number; price: number; usdt: number; pct: number }[] = [];
  for (const symbol of ordered(Object.keys(cfg.weights))) {
    const p = priceOf(symbol, latest, prices);
    const pos = cfg.positions[symbol] ?? 0;
    if (!p || !(pos > 0)) continue;
    const avg = cfg.avgPrice?.[symbol] ?? 0;
    const r = openPnl(cfg, symbol, p.price);
    open += r.usdt;
    unknown ||= !r.known;
    invested += pos * avg;
    rows.push({ symbol, pos, avg, price: p.price, usdt: r.usdt, pct: r.pct });
  }
  const realized = Object.values(cfg.realized ?? {}).reduce((a, b) => a + b, 0);

  // O que fazer hoje: sinais do robo, acoes das fichas e avisos da carteira
  type Todo = { tone: "buy" | "sell" | "warn" | "info"; who: string; text: string; tab: TabId; fin?: FinSub | "loans" | "recv"; prio?: number; id?: string };
  const todo: Todo[] = [];
  // Sinais do robo: uma linha so (os detalhes ficam na aba Robo). Previas nao entram aqui
  const sigs: { coin: string; sell: boolean; usd: number }[] = [];
  for (const l of member ? [] : [...latest].sort((a, b) => SYMBOLS.indexOf(a.symbol) - SYMBOLS.indexOf(b.symbol))) {
    const capital = cfg.capitalUsdt * (cfg.weights[l.symbol] ?? 0);
    const d = decide(l.state, capital, cfg.positions[l.symbol] ?? 0, params);
    if (d.qty > 0) sigs.push({ coin: l.symbol.replace("USDT", ""), sell: d.kind === "VENDER_TUDO" || d.kind === "VENDER_PARTE", usd: d.qty * l.state.close });
  }
  if (sigs.length) {
    const part = (sell: boolean) => { const x = sigs.filter((s) => s.sell === sell); return x.length ? `${sell ? "vender" : "comprar"} ${x.map((s) => s.coin).join(", ")} (~$${fmt(x.reduce((t, s) => t + s.usd, 0))})` : ""; };
    todo.push({ tone: sigs.every((s) => s.sell) ? "sell" : sigs.every((s) => !s.sell) ? "buy" : "warn", who: "Robô", prio: 2,
      text: `${sigs.length} ${sigs.length > 1 ? "sinais" : "sinal"} no fechamento das 21:00: ${[part(true), part(false)].filter(Boolean).join("; ")}`, tab: "sinais" });
  }
  // Fichas dos tokens: uma linha so
  const acts = (fichas?.items ?? []).filter((f) => !SYMBOLS.includes(`${f.symbol}USDT`) && f.situacao
    && (["entrada", "entrada_metade", "saida", "reduzir", "sem_vaga"].includes(f.situacao.code) || f.action));
  if (acts.length) todo.push({ tone: "info", who: "Tokens", prio: 3, tab: "sinais",
    text: acts.slice(0, 4).map((f) => `${f.symbol}: ${f.situacao!.label.toLowerCase()}`).join(" - ") + (acts.length > 4 ? ` e mais ${acts.length - 4}` : "") });
  if (wallet) for (const n of walletNotices(wallet)) if (n.level !== "info") todo.push({ tone: "warn", who: "Carteira", prio: 3, text: n.text, tab: "carteira" });
  if (unknown && !member) todo.push({ tone: "info", who: "Robô", prio: 3, text: "há posição sem preço médio: informe-o em Carteira > Meus tokens para ver o lucro", tab: "sinais" });
  if (sync?.shorts.length) todo.push({ tone: "warn", who: "Lighter", prio: 3, text: `posição vendida (${sync.shorts.join(", ")}) fica fora da conta`, tab: "carteira" });
  // Financas: so recalcula quando os dados de financas mudam (nao a cada atualizacao de preco do cripto, a cada 30 s)
  const finTodo = useMemo(() => {
    const todo: Todo[] = [];
    // Financas: pagamentos vencidos e pontos para revisar
    const upList = upcoming(money.months, money.setup);
    for (const p of upList.filter((x) => x.late))
      todo.push({ tone: "warn", who: "Pagar", prio: 1, id: `late:${p.desc}:${p.d}`, text: !p.loan && !p.card && !p.once
        ? `${p.desc} costuma sair até o dia ${p.d.slice(8, 10)} e ainda não veio no extrato (R$\u00a0${fmt(p.v)})`
        : `${p.desc}: R$\u00a0${fmt(p.v)} venceu em ${new Date(`${p.d}T12:00:00`).toLocaleDateString("pt-BR")}`, tab: "financas", fin: p.loan ? "loans" : p.card ? "cards" : "lanc" });
    for (const r of money.setup.recvs ?? []) {
      const st = recvStatus(r, money.months);
      if (st.late) todo.push({ tone: "warn", who: "Receber", text: `${r.name}: ${st.late} ${st.late > 1 ? "parcelas atrasadas" : "parcela atrasada"} (R$\u00a0${fmt(st.lateV)})`, tab: "financas", fin: "recv" });
    }
    for (const b of budgetAlerts(money.months, money.setup))
      todo.push({ tone: "warn", who: "Cartão", text: `${b.c.name}: R$\u00a0${fmt(b.used, 0)} na fatura aberta, ${fmt(b.pct * 100, 0)}% do planejado (R$\u00a0${fmt(b.c.budget!, 0)})`, tab: "financas", fin: "cards" });
    {
      const cm = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);
      for (const f of money.setup.fixos) if (fixoActive(f, cm) && fixoReajPending(f, cm))
        todo.push({ tone: "info", who: "Fixo", text: `${f.desc} reajusta este mês: atualize o novo valor (Lançamentos > Contas a pagar)`, tab: "financas", fin: "lanc" });
    }
    // entrada fixa que costuma cair e ainda nao veio
  {
    const t0 = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    const cm = t0.slice(0, 7);
    for (const b of monthIncomes(cm, money.months[cm]?.items ?? [], money.setup, money.months))
      if (!b.paid && b.d < t0) todo.push({ tone: "info", who: "Receber", prio: 2, id: `inc:${b.ref}:${cm}`, tab: "financas", fin: "lanc",
        text: `${b.desc} costuma cair até o dia ${b.d.slice(8, 10)} e ainda não veio no extrato (R$\u00a0${fmt(b.v)})` });
  }
  const rc = reviewCount(money.months, money.setup);
    if (rc) todo.push({ tone: "info", who: "Finanças", text: `${rc} ${rc > 1 ? "pontos" : "ponto"} para revisar nos lançamentos (para os números ficarem certos)`, tab: "financas", fin: "lanc" });

    // Avisos inteligentes das financas
    const acctNow = accountBalance(money.months, money.setup);
    const summary = financeSummary(money.cfg.finance ?? [], money.fin, money.wallet, money.spend?.value ?? money.cfg.monthlyCost, acctNow?.value, investFlows(money.months));
    for (const x of buildAlerts({ months: money.months, setup: money.setup, up: upList, saldo: acctNow?.value ?? null, avg: money.spend, reserve: summary.reserve, reserveMonths: summary.reserveMonths, hist: money.nwHist }))
      todo.push({ tone: x.tone, who: x.who, text: x.text, tab: "financas", fin: x.fin, prio: x.prio, id: x.id });
    return todo;
  }, [money.months, money.setup, money.cfg, money.fin, money.wallet, money.spend, money.nwHist]);
  todo.push(...finTodo);
  // Contra poluicao: tira os dispensados neste mes, os mais urgentes primeiro, no maximo 5 (o resto em "ver mais")
  const nowMonth = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);
  const idOf = (t: Todo) => t.id ?? (t.tab === "financas" ? `${t.who}:${t.text}` : null);
  const dismissed = money.setup.dismissed ?? {};
  const prioOf = (t: Todo) => t.prio ?? (t.tab !== "financas" ? (t.tone === "info" ? 3 : 0) : 2);
  const visible = todo.filter((t) => { const i = idOf(t); return !i || dismissed[i] !== nowMonth; }).map((t, i) => ({ t, i })).sort((x, y) => prioOf(x.t) - prioOf(y.t) || x.i - y.i).map((x) => x.t);
  const shownTodo = allTodo ? visible : visible.slice(0, 5);
  const dismiss = async (t: Todo) => {
    const i = idOf(t);
    if (!i) return;
    const keep = Object.fromEntries(Object.entries(dismissed).filter(([, v]) => v === nowMonth));
    await saveSetup({ dismissed: { ...keep, [i]: nowMonth } });
  };

  const total = wallet && wallet.address === walletKey(walletAddresses(cfg)) ? wallet.total : null;
  const blocks = total !== null && wallet ? allocationBlocks(wallet, cfg, latest, fichas) : [];
  const alloc = allocOf(cfg);
  const pctOf = (v: number) => (total ? `${fmt((v / total) * 100, 1)}%` : "");
  const hasMoney = !!(cfg.finance?.length || Object.keys(money.months).length || money.setup.cards.length || money.setup.loans.length);
  const go = (t: Todo) => (t.fin ? onFin(t.fin) : onTab(t.tab));
  // numeros do cripto: dentro do quadro Patrimonio (ou sozinhos, se ainda nao ha financas)
  const cryptoKpis = (
    <div className="kpis compact">
      <div><span>{hasMoney ? "Carteira cripto" : "Patrimônio"}</span><b>{total !== null ? `$${fmt(total)}` : "-"}</b>
        <small className="muted">{total === null ? "cadastre as carteiras" : member ? "suas carteiras" : `núcleo $${fmt(cfg.capitalUsdt)}`}</small></div>
      {!member && <><div><span>Lucro aberto (robô)</span><b className={pnlClass(open)}>{signed(open)}</b>
        <small className="muted">{invested > 0 ? `${signed((open / invested) * 100, 1)}% sobre $${fmt(invested)}` : "sem posição"}</small></div>
      <div><span>Realizado</span><b className={pnlClass(realized)}>{signed(realized)}</b><small className="muted">vendas registradas</small></div>
      <div><span>Total</span><b className={pnlClass(open + realized)}>{signed(open + realized)}</b><small className="muted">sem taxas e funding</small></div></>}
    </div>
  );

  return (
    <>
      {hasMoney && <PatrimonioCard {...money} start={money.cfg.nwStart ?? null} onBens={() => onFin("bens")}>
        <div className="sub-block">
          <div className="sub-head"><b>Cripto</b><button className="link" onClick={() => onTab("carteira")}>ver cripto &rsaquo;</button></div>
          {cryptoKpis}
        </div>
      </PatrimonioCard>}

      <section className="card">
        <h2>O que fazer hoje</h2>
        {visible.length ? (
          <>
          <ul className="todo">
            {shownTodo.map((t, i) => (
              <li key={i} className={`todo-${t.tone}`} onClick={() => go(t)}>
                <b>{t.who}</b><span>{t.text}</span>
                {idOf(t) ? <button className="link todo-x" title="Dispensar até o mês que vem" onClick={(e) => { e.stopPropagation(); dismiss(t); }}>dispensar</button> : <em />}
                <i aria-hidden="true">&rsaquo;</i>
              </li>
            ))}
          </ul>
          {visible.length > 5 && <button className="link" onClick={() => setAllTodo(!allTodo)}>{allTodo ? "ver menos" : `ver mais ${visible.length - 5}`}</button>}
          </>
        ) : (
          <p className="muted">Nada a fazer: nenhum sinal novo, nenhum pagamento vencido e nenhum aviso.</p>
        )}
        <Note>Os mais urgentes primeiro, no máximo 5 (o resto em &quot;ver mais&quot;). Clique num item para ver os detalhes; &quot;dispensar&quot;
          esconde o aviso até o mês que vem.{member ? "" : " Sinais do robô valem só no fechamento diário (21:00 de Brasília)."}</Note>
      </section>

      {hasMoney && <MonthAndUpcoming months={money.months} setup={money.setup} onLanc={() => onFin("lanc")} onBens={() => onFin("bens")} />}
      {hasMoney && <NetWorthBlock {...money} />}

      {!hasMoney && (
        <section className="card">
          <div className="card-head"><h2>Cripto</h2><button className="link" onClick={() => onTab("carteira")}>ver cripto &rsaquo;</button></div>
          {cryptoKpis}
        </section>
      )}


      {!member && <details className="more-block">
        <summary>Alocação e posições do robô</summary>
        <div className="two-col">
        <section className="card">
          <h2>Alocação</h2>
          {blocks.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Bloco</th><th>Alvo</th><th>Real</th><th>Diferença</th></tr></thead>
                <tbody>
                  {blocks.map((b) => (
                    <tr key={b.name}>
                      <td><b>{b.name}</b><div className="muted small">{b.hint}</div></td>
                      <td>{b.target === null ? "o resto" : `$${fmt(b.target)}`}<div className="muted small">{b.target === null ? "" : pctOf(b.target)}</div></td>
                      <td>${fmt(b.real)}<div className="muted small">{pctOf(b.real)}</div></td>
                      <td className={b.target !== null && Math.abs(b.real - b.target) > Math.max(5, 0.1 * (total ?? 0)) ? "warn" : "muted"}>
                        {b.target === null ? "-" : signed(b.real - b.target)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Cadastre as carteiras na engrenagem de Cripto e clique em &quot;Atualizar&quot;.</p>
          )}
          <Note>Divisão: núcleo {fmt(alloc.core * 100, 0)}% / satélite {fmt(alloc.satellite * 100, 0)}% (engrenagem em Cripto).</Note>
        </section>

        <section className="card">
          <h2>Posições do robô</h2>
          {rows.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Moeda</th><th>Posição</th><th>Preço médio</th><th>Agora</th><th>Lucro</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.symbol}>
                      <td><b>{r.symbol.replace("USDT", "")}</b></td><td>{fmtQty(r.pos)}</td>
                      <td>{r.avg > 0 ? fmtPx(r.avg) : "-"}</td><td>{fmtPx(r.price)}</td>
                      <td className={pnlClass(r.usdt)}>{r.avg > 0 ? `${signed(r.usdt)} (${signed(r.pct, 1)}%)` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Sem posição em BTC, ETH ou SOL.</p>
          )}
          <p className="muted small">Preço {prices.at ? `ao vivo (${ago(prices.at)})` : "do último cálculo"}.</p>
        </section>
        </div>
      </details>}
    </>
  );
}
