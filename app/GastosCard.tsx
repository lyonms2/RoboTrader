"use client";
import { doc, setDoc } from "firebase/firestore";
import { useMemo, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { accountBalance, cardStatus, debts } from "@/lib/gastos";
import {
  CATS_GASTO, CATS_NEUTRO, CATS_RECEITA, addMonths, avgMonthly, categorize, dayIn, decode, descKey, faturaMonth, loanStatus, monthLabel,
  monthOf, newId, parcOf, parseCSV, parseOFX, pendingFor, summarize, tipoOfCat, todayBR,
  type Card, type Fixo, type Gasto, type GastosSetup, type Loan, type MonthDoc, type Raw, type Tipo,
} from "@/lib/gastos";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
function num(s: string) {
  let t = s.replace(/[\sR$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t) || 0;
}
const saveMonth = (m: string, items: Gasto[]) =>
  setDoc(doc(db(), "config", `gastos-${m}`), { items: clean([...items].sort((a, b) => a.d.localeCompare(b.d))) });
const saveSetup = (s: Partial<GastosSetup>) => setDoc(doc(db(), "config", "gastos-setup"), clean(s), { merge: true });

// Grava lancamentos que podem cair em meses diferentes (parcelas, importacao)
async function addItems(months: Record<string, MonthDoc>, list: Gasto[]) {
  const by: Record<string, Gasto[]> = {};
  for (const g of list) (by[monthOf(g.d)] ??= []).push(g);
  await Promise.all(Object.entries(by).map(([m, add]) => saveMonth(m, [...(months[m]?.items ?? []), ...add])));
}

export { debts };

// Resumo do mes atual (para a pagina Resumo das Financas)
export function monthSnapshot(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const m = monthOf(todayBR());
  const items = months[m]?.items ?? [];
  const s = summarize(items);
  const pending = pendingFor(m, items, setup);
  return { m, ...s, count: items.length, pending: pending.reduce((a, p) => a + p.v, 0), pendingN: pending.length, avg: avgMonthly(months) };
}

// Cartoes e dividas: resumo + cartoes + emprestimos
export function DebtsView({ months, setup }: { months: Record<string, MonthDoc>; setup: GastosSetup }) {
  const cards = setup.cards.map((c) => ({ c, st: cardStatus(c, months) }));
  const d = debts(months, setup);
  const today = todayBR();
  const monthlyLoans = setup.loans.filter((l) => loanStatus(l, today).left > 0).reduce((s, l) => s + l.parcela, 0);
  const nextBills = cards.filter((x) => x.st.next).map((x) => ({ name: x.c.name, ...x.st.next! })).sort((a, b) => a.due.localeCompare(b.due));
  return (
    <>
      <section className="card">
        <h2>Dividas</h2>
        <div className="kpis">
          <div><span>Total devendo</span><b className={d.total > 0 ? "warn" : ""}>{brl(d.total)}</b><small className="muted">emprestimos + faturas em aberto</small></div>
          <div><span>Emprestimos</span><b>{brl(d.loans)}</b><small className="muted">{monthlyLoans > 0 ? `${brl(monthlyLoans)} por mes em parcelas` : "nenhum ativo"}</small></div>
          <div><span>Cartoes</span><b>{brl(d.cards)}</b><small className="muted">faturas a vencer, com parcelas futuras</small></div>
          <div><span>Proxima fatura</span><b>{nextBills[0] ? brl(nextBills[0].v) : "-"}</b>
            <small className="muted">{nextBills[0] ? `${nextBills[0].name}, vence ${dm(nextBills[0].due)}` : "nenhuma lancada"}</small></div>
        </div>
      </section>
      <div className="two-col">
        <Cards cards={cards} setup={setup} />
        <Loans setup={setup} />
      </div>
    </>
  );
}

export default function GastosCard({ months, setup }: { months: Record<string, MonthDoc>; setup: GastosSetup }) {
  const [m, setM] = useState(monthOf(todayBR()));
  const [filter, setFilter] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const items = months[m]?.items ?? [];
  const s = summarize(items);
  const avg = avgMonthly(months);
  const pending = pendingFor(m, items, setup);
  const pendingTotal = pending.reduce((a, p) => a + p.v, 0);
  const prevAvg = useMemo(() => {
    // media por categoria nos 3 meses anteriores ao mes aberto
    const keys = [1, 2, 3].map((k) => addMonths(m, -k)).filter((k) => months[k]?.items.length);
    const acc: Record<string, number> = {};
    for (const k of keys) for (const [c, v] of Object.entries(summarize(months[k].items).byCat)) acc[c] = (acc[c] ?? 0) + v / keys.length;
    return { acc, n: keys.length };
  }, [m, months]);

  const learnAndSet = async (g: Gasto, cat: string) => {
    const tipo = tipoOfCat(cat) ?? g.tipo;
    const key = descKey(g.desc);
    // Aplica a todos os lancamentos do mes com a mesma descricao e lembra para os proximos
    await saveMonth(m, items.map((x) => (x.id === g.id || (key && descKey(x.desc) === key) ? { ...x, cat, tipo } : x)));
    if (key) await saveSetup({ rules: { ...setup.rules, [key]: cat } });
  };
  const removeItem = async (g: Gasto) => {
    if (!confirm(`Apagar "${g.desc}" (${brl(g.v)})?`)) return;
    await saveMonth(m, items.filter((x) => x.id !== g.id));
  };
  const launch = async (p: (typeof pending)[number]) => {
    await saveMonth(m, [...items, { id: newId(), d: p.d, desc: p.desc, v: p.v, tipo: "gasto", io: "out", cat: p.cat, src: p.parc ? "emprestimo" : "fixo", ref: p.ref, ...(p.card ? { card: p.card } : {}), ...(p.parc ? { parc: p.parc } : {}) }]);
  };

  const shown = [...items].filter((g) => !filter || g.cat === filter).sort((a, b) => b.d.localeCompare(a.d));
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...cats.map(([c, v]) => Math.max(v, prevAvg.acc[c] ?? 0)), 0);
  const isNow = m === monthOf(todayBR());

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div className="month-nav">
            <button className="ghost icon" aria-label="Mes anterior" onClick={() => setM(addMonths(m, -1))}>&lsaquo;</button>
            <h2>{monthLabel(m, true)}</h2>
            <button className="ghost icon" aria-label="Proximo mes" onClick={() => setM(addMonths(m, 1))}>&rsaquo;</button>
            {!isNow && <button className="ghost small-btn" onClick={() => setM(monthOf(todayBR()))}>hoje</button>}
          </div>
          <span className="muted small">{items.length} lancamentos</span>
        </div>
        <div className="kpis">
          <div><span>Gastos</span><b>{brl(s.gastos)}</b>
            <small className={avg && s.gastos > avg.value * 1.1 ? "warn" : "muted"}>{avg ? `media ${brl(avg.value, 0)} (${avg.months} ${avg.months > 1 ? "meses" : "mes"})` : "a media aparece no 2o mes"}</small></div>
          <div><span>Entradas</span><b>{brl(s.receitas)}</b><small className="muted">salario, Pix recebidos...</small></div>
          <div><span>Sobrou</span><b className={s.receitas - s.gastos >= 0 ? "pos" : "neg"}>{brl(s.receitas - s.gastos)}</b>
            <small className="muted">{s.receitas > 0 ? `${fmt(((s.receitas - s.gastos) / s.receitas) * 100, 0)}% das entradas` : "entradas - gastos"}</small></div>
          <div><span>Ainda a pagar</span><b className={pendingTotal > 0 ? "warn" : ""}>{brl(pendingTotal)}</b>
            <small className="muted">{pending.length ? `${pending.length} fixos/parcelas - previsto ${brl(s.gastos + pendingTotal, 0)}` : "fixos e parcelas em dia"}</small></div>
        </div>
        <AccountBox months={months} setup={setup} />
        {pending.length > 0 && (
          <ul className="pend small">
            {pending.map((p) => (
              <li key={p.ref}>
                <span className="muted">{dm(p.d)}</span> <b>{p.desc}</b> <span>{brl(p.v)}</span>
                <button className="ghost small-btn" onClick={() => launch(p)}>marcar pago</button>
              </li>
            ))}
          </ul>
        )}
        {cats.length > 0 && (
          <figure className="viz">
            <figcaption className="small muted">Gastos por categoria {prevAvg.n ? <>- <i className="tick-key" /> media dos {prevAvg.n} meses anteriores</> : ""} (clique para filtrar)</figcaption>
            <div className="hbars">
              {cats.map(([c, v]) => {
                const a = prevAvg.acc[c];
                return (
                  <div key={c} className={`hbar click${filter && filter !== c ? " dim" : ""}`} onClick={() => setFilter(filter === c ? null : c)}
                    title={`${c}: ${brl(v)}${a ? ` (media ${brl(a)})` : ""}`}>
                    <span className="hbar-label small">{c}</span>
                    <span className="hbar-track">
                      <span className="hbar-fill" style={{ width: `${(v / maxCat) * 100}%` }} />
                      {a ? <span className="hbar-tick" style={{ left: `${(a / maxCat) * 100}%` }} /> : null}
                    </span>
                    <span className="hbar-value small">{fmt(v, 0)} <span className={a && v > a * 1.2 ? "warn" : "muted"}>{s.gastos > 0 ? `${fmt((v / s.gastos) * 100, 0)}%` : ""}</span></span>
                  </div>
                );
              })}
            </div>
          </figure>
        )}
        <MonthsChart months={months} current={m} onPick={setM} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Lancamentos {filter && <span className="tag">{filter} <button className="link" onClick={() => setFilter(null)}>x</button></span>}</h2>
          <div className="row">
            <button className="ghost" onClick={() => setImporting(!importing)}>{importing ? "Fechar importacao" : "Importar extrato"}</button>
          </div>
        </div>
        {importing ? <ImportPanel months={months} setup={setup} onDone={() => setImporting(false)} />
          : <QuickAdd months={months} setup={setup} defaultDate={isNow ? todayBR() : `${m}-01`} />}
        {shown.length ? (
          <div className="table-scroll">
            <table className="stack gastos">
              <thead><tr><th>Descricao</th><th>Categoria</th><th>Valor</th><th /></tr></thead>
              <tbody>
                {shown.map((g) => {
                  const card = setup.cards.find((c) => c.id === g.card);
                  return (
                    <tr key={g.id} className={g.tipo === "neutro" ? "neutral" : ""}>
                      <td><span className="cell">{g.desc}<small className="muted">
                        {[dm(g.d), card ? `cartao ${card.name}` : null, g.parc ? `parcela ${g.parc[0]}/${g.parc[1]}` : null, g.tipo === "neutro" ? "nao conta nos gastos" : null].filter(Boolean).join(" - ")}
                      </small></span></td>
                      <td data-label="Categoria"><CatSelect value={g.cat} onChange={(c) => learnAndSet(g, c)} /></td>
                      <td data-label="Valor" className={g.tipo === "receita" ? "pos" : g.tipo === "neutro" ? "muted" : ""}>{g.tipo === "receita" ? "+" : g.tipo === "gasto" ? "-" : ""}{brl(g.v)}</td>
                      <td className="actions"><button className="ghost small-btn" onClick={() => removeItem(g)} aria-label="Apagar">apagar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Nenhum lancamento {filter ? "nesta categoria" : "neste mes"}.</p>}
        <p className="muted small">Mudou a categoria de um lancamento? O site aplica aos iguais do mes e lembra para as proximas importacoes.
          Pagamento de fatura, aplicacoes e resgates nao contam como gasto (as compras do cartao ja contam).</p>
      </section>

      <Fixos setup={setup} />
    </>
  );
}

function CatSelect({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="cat-sel">
      <optgroup label="Gastos">{CATS_GASTO.map((c) => <option key={c}>{c}</option>)}</optgroup>
      <optgroup label="Entradas">{CATS_RECEITA.map((c) => <option key={c}>{c}</option>)}</optgroup>
      <optgroup label="Nao conta">{CATS_NEUTRO.map((c) => <option key={c}>{c}</option>)}</optgroup>
      {!tipoOfCat(value) && <option>{value}</option>}
    </select>
  );
}

// Saldo em conta: o que sobra (ou falta) dos lancamentos entra no patrimonio como "Conta corrente"
function AccountBox({ months, setup }: { months: Record<string, MonthDoc>; setup: GastosSetup }) {
  const acct = accountBalance(months, setup);
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState(setup.account ? fmt(setup.account.balance) : "");
  const [at, setAt] = useState(setup.account?.at ?? todayBR());
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = bal.trim();
    await saveSetup({ account: t ? { balance: num(t.replace(/\u2212/g, "-")), at } : null } as unknown as Partial<GastosSetup>);
    setOpen(false);
  };
  return (
    <div className="acct small">
      <span>Saldo em conta {acct?.informed ? "" : "(sobra acumulada)"}: <b className={acct && acct.value < 0 ? "neg" : ""}>{acct ? brl(acct.value) : "-"}</b></span>
      <span className="muted">
        {acct?.informed ? `saldo de ${dm(setup.account!.at)} + movimentos depois` : acct ? `entradas - saidas da conta desde ${dm(acct.since)}` : "sem lancamentos"}
        {" "}- entra no patrimonio como Conta corrente
      </span>
      {!open && <button className="link" onClick={() => setOpen(true)}>{setup.account ? "atualizar saldo" : "informar saldo atual"}</button>}
      {open && (
        <form className="row wrapline acct-form" onSubmit={save}>
          <label>Saldo somado das contas (R$)<input value={bal} inputMode="decimal" onChange={(e) => setBal(e.target.value)} placeholder="ex.: 1.250,00" /></label>
          <label>Em<input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          <button className="primary" type="submit">Salvar</button>
          <button className="ghost" type="button" onClick={() => setOpen(false)}>Cancelar</button>
          <span className="muted">Lancamentos ate essa data ja estao no saldo; os seguintes somam ou descontam. Deixe vazio para voltar a sobra acumulada.</span>
        </form>
      )}
    </div>
  );
}

// Lancamento rapido: categoria sugerida pela descricao; no cartao pode ser parcelado
function QuickAdd({ months, setup, defaultDate }: { months: Record<string, MonthDoc>; setup: GastosSetup; defaultDate: string }) {
  const [d, setD] = useState(defaultDate);
  const [desc, setDesc] = useState("");
  const [v, setV] = useState("");
  const [entrada, setEntrada] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [card, setCard] = useState("");
  const [n, setN] = useState("1");
  const [busy, setBusy] = useState(false);
  const auto = categorize(desc, entrada, setup.rules);
  const finalCat = cat ?? auto.cat;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = num(v);
    if (!desc.trim() || !(total > 0)) return;
    setBusy(true);
    const tipo: Tipo = tipoOfCat(finalCat) ?? (entrada ? "receita" : "gasto");
    const parcels = card && !entrada ? Math.max(1, Math.min(48, Math.round(num(n)) || 1)) : 1;
    const each = Math.round((total / parcels) * 100) / 100;
    const list: Gasto[] = Array.from({ length: parcels }, (_, k) => ({
      id: newId(), d: dayIn(addMonths(monthOf(d), k), Number(d.slice(8, 10))), desc: desc.trim(), v: each, tipo, io: entrada ? "in" as const : "out" as const, cat: finalCat, src: "manual" as const,
      ...(card ? { card } : {}), ...(parcels > 1 ? { parc: [k + 1, parcels] as [number, number] } : {}),
    }));
    await addItems(months, list);
    if (cat && descKey(desc)) await saveSetup({ rules: { ...setup.rules, [descKey(desc)]: cat } });
    setDesc(""); setV(""); setCat(null); setN("1"); setBusy(false);
  };
  return (
    <form className="fin-form quick" onSubmit={submit}>
      <div className="kind-pick">
        <button type="button" className={!entrada ? "pill on" : "pill"} onClick={() => { setEntrada(false); setCat(null); }}>Gasto</button>
        <button type="button" className={entrada ? "pill on" : "pill"} onClick={() => { setEntrada(true); setCat(null); setCard(""); }}>Entrada</button>
      </div>
      <div className="row wrapline">
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="grow">Descricao<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={entrada ? "Salario" : "Mercado, ifood, aluguel..."} /></label>
        <label>Valor (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder="0,00" /></label>
        <label>Categoria<CatSelect value={finalCat} onChange={setCat} /></label>
        {!entrada && (
          <label>Pagamento
            <select value={card} onChange={(e) => setCard(e.target.value)}>
              <option value="">Debito / Pix / dinheiro</option>
              {setup.cards.map((c) => <option key={c.id} value={c.id}>Cartao {c.name}</option>)}
            </select>
          </label>
        )}
        {card && !entrada && <label>Parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 70 }} /></label>}
        <button type="submit" className="primary" disabled={busy || !desc.trim() || !(num(v) > 0)}>Lancar</button>
      </div>
      {card && num(n) > 1 && num(v) > 0 && <p className="muted small">{Math.round(num(n))}x de {brl(num(v) / Math.round(num(n)))} - uma parcela em cada mes.</p>}
    </form>
  );
}

// Importar extrato OFX ou CSV: tudo e lido no seu navegador; so os lancamentos escolhidos sao gravados
function ImportPanel({ months, setup, onDone }: { months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void }) {
  type Row = Raw & { on: boolean; cat: string; tipo: Tipo; dup: "" | "ja importado" | "parece repetido" };
  const [rows, setRows] = useState<Row[]>([]);
  const [file, setFile] = useState("");
  const [err, setErr] = useState("");
  const [card, setCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownName, setOwnName] = useState(setup.ownName ?? "");
  const [info, setInfo] = useState("");
  const all = Object.values(months).flatMap((md) => md.items);
  const exts = new Set(all.map((g) => g.ext).filter(Boolean));
  const build = (raw: Raw[]): Row[] => raw.map((r) => {
    const { cat, tipo } = categorize(r.desc, r.amount > 0, setup.rules, ownName);
    const dup = exts.has(r.ext) ? "ja importado" as const
      : all.some((g) => g.d === r.d && Math.abs(g.v - Math.abs(r.amount)) < 0.005 && !g.ext) ? "parece repetido" as const : "" as const;
    return { ...r, cat, tipo, dup, on: !dup };
  });
  const onFile = async (f: File) => {
    setErr("");
    setInfo("");
    setFile(f.name);
    const text = decode(await f.arrayBuffer());
    if (/<OFX>|OFXHEADER/i.test(text)) {
      const raw = parseOFX(text);
      if (!raw.length) return setErr("Nenhum lancamento encontrado no OFX.");
      if (/<CREDITCARDMSGSRSV1>/i.test(text) && setup.cards.length) setCard(setup.cards[0].id);
      setRows(build(raw));
    } else {
      const r = parseCSV(text);
      if (r.error) return setErr(`CSV: ${r.error}. Se puder, exporte em OFX ou me mande o modelo do banco.`);
      setInfo(r.info ?? "");
      if (r.cardStyle && setup.cards.length) setCard(setup.cards[0].id);
      setRows(build(r.rows));
    }
  };
  const invert = () => setRows(build(rows.map((r) => ({ ...r, amount: -r.amount }))));
  const chosen = rows.filter((r) => r.on);
  const save = async () => {
    setBusy(true);
    if ((setup.ownName ?? "") !== ownName.trim()) await saveSetup({ ownName: ownName.trim() });
    await addItems(months, chosen.map((r) => ({
      id: newId(), d: r.d, desc: r.desc, v: Math.abs(r.amount), tipo: r.tipo, io: r.amount > 0 ? "in" as const : "out" as const, cat: r.cat, src: "import" as const, ext: r.ext,
      ...(card ? { card } : {}), ...(parcOf(r.desc) ? { parc: parcOf(r.desc) } : {}),
    })));
    setBusy(false);
    onDone();
  };
  const setRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const out = chosen.filter((r) => r.tipo === "gasto").reduce((s, r) => s + Math.abs(r.amount), 0);
  const inn = chosen.filter((r) => r.tipo === "receita").reduce((s, r) => s + Math.abs(r.amount), 0);
  return (
    <div className="fin-form">
      <p className="small">No app do banco, exporte o extrato ou a fatura em <b>OFX</b> (quase todos os bancos) ou <b>CSV</b> (PicPay, Nubank, Inter, Itau, Bradesco, BB, C6, Mercado Pago...) e escolha o arquivo.
        Ele e lido aqui no navegador; nada e enviado para o banco e nenhuma senha e pedida.</p>
      <div className="row wrapline">
        <label className="file-btn">Escolher arquivo<input type="file" accept=".ofx,.csv,.txt,.qfx" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        <span className="muted small">{file}</span>
        <label>De onde e<select value={card} onChange={(e) => setCard(e.target.value)}>
          <option value="">Conta (debito / Pix)</option>
          {setup.cards.map((c) => <option key={c.id} value={c.id}>Fatura do cartao {c.name}</option>)}
        </select></label>
        {rows.length > 0 && <button type="button" className="ghost small-btn" onClick={invert}>inverter sinais</button>}
      </div>
      <div className="row wrapline">
        <label className="grow">Seu nome como aparece no extrato (Pix entre suas contas nao conta como gasto)
          <input value={ownName} onChange={(e) => setOwnName(e.target.value)} onBlur={() => rows.length && setRows(build(rows))} placeholder="Nome Sobrenome" autoComplete="off" />
        </label>
      </div>
      {err && <p className="error small">{err}</p>}
      {rows.length > 0 && (
        <>
          {info && <p className="muted small">Lido: {info}.</p>}
          <p className="small">{rows.length} lancamentos no arquivo - {chosen.length} marcados: gastos {brl(out)}, entradas {brl(inn)}.
            {rows.some((r) => r.dup) && <span className="muted"> Os ja importados ou repetidos vieram desmarcados.</span>}</p>
          <div className="table-scroll import-list">
            <table className="stack gastos">
              <thead><tr><th /><th>Data</th><th>Descricao</th><th>Categoria</th><th>Valor</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ext}${i}`} className={r.on ? "" : "off"}>
                    <td><input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} aria-label="Importar" /></td>
                    <td data-label="Data">{dm(r.d)}</td>
                    <td data-label="Descricao"><span className="cell">{r.desc}{r.dup && <small className="warn">{r.dup}</small>}</span></td>
                    <td data-label="Categoria"><CatSelect value={r.cat} onChange={(c) => setRow(i, { cat: c, tipo: tipoOfCat(c) ?? r.tipo })} /></td>
                    <td data-label="Valor" className={r.tipo === "receita" ? "pos" : r.tipo === "neutro" ? "muted" : ""}>{r.amount > 0 ? "+" : "-"}{brl(Math.abs(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="primary" disabled={busy || !chosen.length} onClick={save}>{busy ? "Gravando..." : `Importar ${chosen.length} lancamentos`}</button>
            <button className="ghost" onClick={onDone}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

// Colunas por mes: gastos x entradas (ultimos 6 meses ate o mes aberto)
function MonthsChart({ months, current, onPick }: { months: Record<string, MonthDoc>; current: string; onPick: (m: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const list = Array.from({ length: 6 }, (_, i) => addMonths(current, i - 5)).map((m) => ({ m, ...summarize(months[m]?.items ?? []) }));
  const max = Math.max(...list.map((x) => Math.max(x.gastos, x.receitas)), 0);
  if (!(max > 0) || list.filter((x) => x.gastos + x.receitas > 0).length < 2) return null;
  const h = hover !== null ? list[hover] : null;
  return (
    <figure className="viz">
      <figcaption className="small muted">
        Ultimos 6 meses <i className="key k-in" /> entradas <i className="key k-out" /> gastos
        {h ? ` - ${monthLabel(h.m)}: entradas ${brl(h.receitas, 0)}, gastos ${brl(h.gastos, 0)}` : ""}
      </figcaption>
      <div className="mbars six" onMouseLeave={() => setHover(null)}>
        {list.map((x, i) => (
          <div key={x.m} className={`mbar pair${hover !== null && hover !== i ? " dim" : ""}${x.m === current ? " cur" : ""}`}
            onMouseEnter={() => setHover(i)} onClick={() => onPick(x.m)} title={`${monthLabel(x.m)}: entradas ${brl(x.receitas)}, gastos ${brl(x.gastos)}`}>
            <span className="pair-bars">
              <span className="mbar-fill in" style={{ height: `${(x.receitas / max) * 100}%` }} />
              <span className="mbar-fill out" style={{ height: `${(x.gastos / max) * 100}%` }} />
            </span>
            <small>{monthLabel(x.m)}</small>
          </div>
        ))}
      </div>
    </figure>
  );
}

function Cards({ cards, setup }: { cards: { c: Card; st: ReturnType<typeof cardStatus> }[]; setup: GastosSetup }) {
  const [form, setForm] = useState<Card | null>(null);
  const save = async (c: Card) => {
    await saveSetup({ cards: setup.cards.some((x) => x.id === c.id) ? setup.cards.map((x) => (x.id === c.id ? c : x)) : [...setup.cards, c] });
    setForm(null);
  };
  const remove = async (c: Card) => {
    if (confirm(`Remover o cartao ${c.name}? (os lancamentos continuam)`)) await saveSetup({ cards: setup.cards.filter((x) => x.id !== c.id) });
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Cartoes</h2>{!form && <button className="ghost small-btn" onClick={() => setForm({ id: newId(), name: "", closeDay: 1, dueDay: 8 })}>+ cartao</button>}</div>
      {form && <CardForm c={form} onSave={save} onCancel={() => setForm(null)} />}
      {cards.length ? cards.map(({ c, st }) => (
        <div key={c.id} className="debt">
          <div className="row between">
            <b>{c.name}</b>
            <span className="muted small">fecha dia {c.closeDay}, vence dia {c.dueDay}
              <button className="link" onClick={() => setForm(c)}>editar</button><button className="link" onClick={() => remove(c)}>remover</button></span>
          </div>
          {st.next ? (
            <p className="small">Proxima fatura: <b>{brl(st.next.v)}</b> vence {dm(st.next.due)}
              {st.faturas.length > 1 && <span className="muted"> - depois: {st.faturas.slice(1, 4).map((f) => `${monthLabel(f.m)} ${brl(f.v, 0)}`).join(", ")}{st.faturas.length > 4 ? "..." : ""}</span>}</p>
          ) : <p className="muted small">Sem fatura em aberto lancada.</p>}
          {c.limit ? (
            <div className="limit" title={`${brl(st.open)} de ${brl(c.limit)}`}>
              <span className={st.open > c.limit * 0.8 ? "limit-fill high" : "limit-fill"} style={{ width: `${Math.min(100, (st.open / c.limit) * 100)}%` }} />
              <small className="muted">limite usado {fmt((st.open / c.limit) * 100, 0)}% ({brl(st.open, 0)} de {brl(c.limit, 0)})</small>
            </div>
          ) : st.open > 0 ? <p className="muted small">Em aberto (com parcelas futuras): {brl(st.open)}</p> : null}
        </div>
      )) : !form && <p className="muted small">Cadastre seus cartoes para ver a fatura de cada um e as parcelas que ainda vem.</p>}
    </section>
  );
}

function CardForm({ c, onSave, onCancel }: { c: Card; onSave: (c: Card) => void; onCancel: () => void }) {
  const [name, setName] = useState(c.name);
  const [close, setClose] = useState(String(c.closeDay));
  const [due, setDue] = useState(String(c.dueDay));
  const [limit, setLimit] = useState(c.limit ? fmt(c.limit, 0) : "");
  const day = (s: string) => Math.max(1, Math.min(31, Math.round(num(s)) || 1));
  return (
    <form className="fin-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave({ id: c.id, name: name.trim(), closeDay: day(close), dueDay: day(due), ...(num(limit) > 0 ? { limit: num(limit) } : {}) }); }}>
      <div className="row wrapline">
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nubank" /></label>
        <label>Dia que fecha<input value={close} inputMode="numeric" onChange={(e) => setClose(e.target.value)} style={{ width: 70 }} /></label>
        <label>Dia que vence<input value={due} inputMode="numeric" onChange={(e) => setDue(e.target.value)} style={{ width: 70 }} /></label>
        <label>Limite (opcional)<input value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} /></label>
      </div>
      <div className="row"><button className="primary" type="submit">Salvar</button><button className="ghost" type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function Loans({ setup }: { setup: GastosSetup }) {
  const [form, setForm] = useState<Loan | null>(null);
  const today = todayBR();
  const save = async (l: Loan) => {
    await saveSetup({ loans: setup.loans.some((x) => x.id === l.id) ? setup.loans.map((x) => (x.id === l.id ? l : x)) : [...setup.loans, l] });
    setForm(null);
  };
  const remove = async (l: Loan) => {
    if (confirm(`Remover ${l.name}?`)) await saveSetup({ loans: setup.loans.filter((x) => x.id !== l.id) });
  };
  const list = setup.loans.map((l) => ({ l, st: loanStatus(l, today) }));
  const total = list.reduce((s, x) => s + x.st.saldo, 0);
  const monthly = list.filter((x) => x.st.left > 0).reduce((s, x) => s + x.l.parcela, 0);
  return (
    <section className="card">
      <div className="card-head"><h2>Emprestimos e financiamentos</h2>{!form && <button className="ghost small-btn" onClick={() => setForm({ id: newId(), name: "", parcela: 0, n: 12, first: monthOf(today), dueDay: 10 })}>+ emprestimo</button>}</div>
      {form && <LoanForm l={form} onSave={save} onCancel={() => setForm(null)} />}
      {list.length > 0 && <p className="small">Devendo <b>{brl(total)}</b> - {brl(monthly)} por mes em parcelas.</p>}
      {list.map(({ l, st }) => (
        <div key={l.id} className="debt">
          <div className="row between">
            <b>{l.name}</b>
            <span className="muted small"><button className="link" onClick={() => setForm(l)}>editar</button><button className="link" onClick={() => remove(l)}>remover</button></span>
          </div>
          <div className="limit">
            <span className="limit-fill paid" style={{ width: `${(st.paid / l.n) * 100}%` }} />
            <small className="muted">{st.paid} de {l.n} parcelas pagas - {st.left > 0 ? `termina em ${monthLabel(st.end, true)}` : "quitado"}</small>
          </div>
          {st.left > 0 && <p className="small">Parcela {brl(l.parcela)} (dia {l.dueDay}) - saldo devedor {l.rate ? "" : "~"}{brl(st.saldo)}
            {l.rate ? <span className="muted"> com juros de {fmt(l.rate)}% ao mes</span> : <span className="muted"> (soma das parcelas; informe os juros para o valor de quitacao)</span>}</p>}
        </div>
      ))}
      {!list.length && !form && <p className="muted small">Cadastre emprestimos e financiamentos: a parcela entra sozinha no &quot;ainda a pagar&quot; de cada mes e a divida e descontada do patrimonio.</p>}
    </section>
  );
}

function LoanForm({ l, onSave, onCancel }: { l: Loan; onSave: (l: Loan) => void; onCancel: () => void }) {
  const [name, setName] = useState(l.name);
  const [parcela, setParcela] = useState(l.parcela ? fmt(l.parcela) : "");
  const [n, setN] = useState(String(l.n));
  const [first, setFirst] = useState(l.first);
  const [due, setDue] = useState(String(l.dueDay));
  const [rate, setRate] = useState(l.rate ? String(l.rate).replace(".", ",") : "");
  return (
    <form className="fin-form" onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim() || !(num(parcela) > 0) || !(num(n) >= 1)) return;
      onSave({ id: l.id, name: name.trim(), parcela: num(parcela), n: Math.round(num(n)), first, dueDay: Math.max(1, Math.min(31, Math.round(num(due)) || 1)), ...(num(rate) > 0 ? { rate: num(rate) } : {}) });
    }}>
      <div className="row wrapline">
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Financiamento do carro" /></label>
        <label>Parcela (R$)<input value={parcela} inputMode="decimal" onChange={(e) => setParcela(e.target.value)} /></label>
        <label>Total de parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 80 }} /></label>
        <label>Mes da 1a parcela<input type="month" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label>Dia do vencimento<input value={due} inputMode="numeric" onChange={(e) => setDue(e.target.value)} style={{ width: 70 }} /></label>
        <label>Juros % ao mes (opcional)<input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder="1,99" /></label>
      </div>
      <div className="row"><button className="primary" type="submit">Salvar</button><button className="ghost" type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function Fixos({ setup }: { setup: GastosSetup }) {
  const [desc, setDesc] = useState("");
  const [v, setV] = useState("");
  const [dia, setDia] = useState("10");
  const [cat, setCat] = useState<string | null>(null);
  const finalCat = cat ?? categorize(desc, false, setup.rules).cat;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim() || !(num(v) > 0)) return;
    const f: Fixo = { id: newId(), desc: desc.trim(), v: num(v), cat: finalCat, dia: Math.max(1, Math.min(31, Math.round(num(dia)) || 1)) };
    await saveSetup({ fixos: [...setup.fixos, f] });
    setDesc(""); setV(""); setCat(null);
  };
  const total = setup.fixos.reduce((s, f) => s + f.v, 0);
  return (
    <section className="card">
      <div className="card-head"><h2>Gastos fixos</h2>{setup.fixos.length > 0 && <span className="muted small">{brl(total)} por mes</span>}</div>
      {setup.fixos.length > 0 && (
        <ul className="pend small">
          {setup.fixos.map((f) => (
            <li key={f.id}><span className="muted">dia {f.dia}</span> <b>{f.desc}</b> <span className="muted">{f.cat}</span> <span>{brl(f.v)}</span>
              <button className="ghost small-btn" onClick={() => saveSetup({ fixos: setup.fixos.filter((x) => x.id !== f.id) })}>remover</button></li>
          ))}
        </ul>
      )}
      <form className="fin-form" onSubmit={add}>
        <div className="row wrapline">
          <label className="grow">Descricao<input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Aluguel, internet, escola..." /></label>
          <label>Valor (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
          <label>Dia<input value={dia} inputMode="numeric" onChange={(e) => setDia(e.target.value)} style={{ width: 60 }} /></label>
          <label>Categoria<CatSelect value={finalCat} onChange={setCat} /></label>
          <button className="primary" type="submit" disabled={!desc.trim() || !(num(v) > 0)}>Adicionar</button>
        </div>
      </form>
      <p className="muted small">Fixos aparecem em &quot;Ainda a pagar&quot; todo mes ate voce marcar pago ou importar um extrato com o mesmo valor (2% de tolerancia) na mesma categoria.</p>
    </section>
  );
}
