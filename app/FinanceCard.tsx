"use client";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import { GROUPS, cdiYear, financeSummary, tesouroOptions, type FinGroup, type FinRow } from "@/lib/financeMath";
import type { AppConfig, FinanceDoc, FinItem, FinKind, WalletDoc } from "@/lib/types";
import { accountBalance, accountsOf, investFlows, monthLabel, monthOf, newId, todayBR, type Account, type Card, type GastosSetup, type Loan, type MonthDoc } from "@/lib/gastos";
import GastosCard, { AccountForm, AccountsPanel, CardForm, DebtsBlock, FixoForm, Fixos, ImportPanel, LoanForm, QuickAdd, monthSnapshot, saveSetup, upcoming } from "./GastosCard";
import NetWorthChart from "./NetWorthChart";
import CardsLoans, { type CardsEntry } from "./CardsLoans";
import { netWorth, type NetWorthDoc } from "@/lib/patrimonio";

// Resumo = ver como esta; Lancamentos = unico lugar onde o dinheiro se move; Contas e bens = unico lugar com saldos e cadastros
// O resumo (patrimonio, mes, proximos pagamentos, evolucao) fica na Visao geral
export type Sub = "lanc" | "cards" | "bens";
const SUBS: { id: Sub; label: string }[] = [
  { id: "lanc", label: "Lancamentos" }, { id: "cards", label: "Cartoes e emprestimos" }, { id: "bens", label: "Contas e bens" },
];
const OLD_SUB: Record<string, Sub> = { gastos: "lanc", invest: "bens", dividas: "bens", resumo: "lanc", loans: "cards" };

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}R$ ${fmt(Math.abs(v))}`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const short = (n: string) => (n.length > 48 ? `${n.slice(0, 46)}...` : n);
const pctS = (v: number, d = 1) => `${fmt(v * 100, d)}%`;
// Numero no formato brasileiro: "5.000,50" e "5.000" (milhar) ou "0,35" / "0.35" (decimal)
export function parse(s: string) {
  let t = s.replace(/[\sR$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t) || 0;
}
const KINDS: { key: FinKind; label: string; hint: string }[] = [
  { key: "caixa", label: "Conta / cofrinho", hint: "saldo + % do CDI: o rendimento ate hoje e estimado sozinho" },
  { key: "tesouro", label: "Tesouro Direto", hint: "titulo + quantidade: o preco do dia vem do Tesouro" },
  { key: "acao", label: "Acao / FII / ETF", hint: "codigo + quantidade: cotacao e proventos automaticos" },
  { key: "outro", label: "Outro", hint: "previdencia, poupanca, imovel... valor digitado a mao" },
];

// Aba Financas: tudo num lugar so (cripto das carteiras + reserva, Tesouro, acoes/FIIs e outros), em reais
export default function FinanceCard({ cfg, fin, wallet, onChanged, spend, debt, months, setup }: {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; onChanged: () => void;
  spend: { value: number; months: number } | null; // media de gastos
  debt: { total: number; loans: number; cards: number };
  months: Record<string, MonthDoc>; setup: GastosSetup;
}) {
  // Sub-aba aberta, lembrada neste navegador
  const [sub, setSubState] = useState<Sub>(() => {
    try {
      const raw = localStorage.getItem("finSub") ?? "";
      const v = (OLD_SUB[raw] ?? raw) as Sub;
      return SUBS.some((x) => x.id === v) ? v : "lanc";
    } catch {
      return "lanc";
    }
  });
  const setSub = (v: Sub) => {
    setSubState(v);
    try { localStorage.setItem("finSub", v); } catch { /* sem armazenamento */ }
    window.scrollTo({ top: 0 });
  };
  const [entry, setEntry] = useState<{ type: EntryType; id: string | null }>({ type: "mov", id: null });
  // "loans" (aviso de parcela atrasada na Visao geral) abre direto em Emprestimos
  const [cardsEntry, setCardsEntry] = useState<CardsEntry>(() => {
    try { if (localStorage.getItem("finSub") === "loans") return { type: "loan", id: null }; } catch { /* sem armazenamento */ }
    return { type: "compra", id: null };
  });
  // cartao e emprestimo se lancam em Cartoes e emprestimos; o resto em Lancamentos
  const goEdit = (type: EntryType | "card" | "loan", id: string | null) => {
    if (type === "card" || type === "loan") { setCardsEntry({ type, id }); setSub("cards"); return; }
    setEntry({ type, id }); setSub("lanc");
  };
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));

  async function save(list: FinItem[], fetchQuotes: boolean) {
    await setDoc(doc(db(), "config/main"), { finance: JSON.parse(JSON.stringify(list)) }, { merge: true });
    if (fetchQuotes) onChanged();
  }
  const upsert = async (it: FinItem) => {
    const list = items.some((x) => x.id === it.id) ? items.map((x) => (x.id === it.id ? it : x)) : [...items, it];
    setEntry({ type: "inv", id: null });
    await save(list, it.kind === "acao" || it.kind === "tesouro");
  };
  const remove = async (it: FinItem) => {
    if (!confirm(`Remover "${it.name}" da lista? (so tira do site, nao mexe no investimento)`)) return;
    await save(items.filter((x) => x.id !== it.id), false);
    setEntry({ type: "inv", id: null });
  };

  const order = GROUPS.map((g) => g.key);
  const rows = [...s.rows].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (b.value ?? 0) - (a.value ?? 0));
  const mon = monthSnapshot(months, setup);
  // Contas e bens nao inclui a cripto (ela tem a aba Carteira); a Visao geral soma tudo
  const crypto = s.byGroup.cripto + s.byGroup.dolar;
  const noCrypto = s.total - crypto;
  const fin0 = noCrypto - s.bens; // contas + investimentos (sem cripto e sem bens)
  const invRows = rows.filter((r) => r.item.kind !== "bem");
  const bemRows = rows.filter((r) => r.item.kind === "bem");

  const nav = (
    <nav className="subtabs" role="tablist" aria-label="Financas">
      {SUBS.map((x) => (
        <button key={x.id} role="tab" aria-selected={sub === x.id} className={sub === x.id ? "pill on" : "pill"} onClick={() => setSub(x.id)}>{x.label}</button>
      ))}
    </nav>
  );
  const entryPanel = (
    <EntryPanel entry={entry} setEntry={setEntry} months={months} setup={setup} invest={items} fin={fin}
      onSaveInv={upsert} onRemoveInv={remove} />
  );
  if (sub === "cards") return <>{nav}<CardsLoans months={months} setup={setup} invest={items} entry={cardsEntry} setEntry={setCardsEntry} /></>;
  if (sub === "lanc") return <>{nav}<GastosCard months={months} setup={setup} invest={items} onBens={() => setSub("bens")} entry={entryPanel} /></>;

  return (
    <>
      {nav}
      {sub === "bens" && <>
      <section className="card">
        <h2>Balanco</h2>
        <div className="kpis">
          <div><span>Contas e investimentos</span><b>{brl(fin0)}</b><small className="muted">sem cripto e sem bens</small></div>
          <div><span>Bens</span><b>{brl(s.bens)}</b><small className="muted">imoveis, terrenos, veiculos</small></div>
          <div><span>O que voce deve</span><b className={debt.total > 0 ? "warn" : ""}>{brl(debt.total)}</b><small className="muted">cartoes {brl(debt.cards, 0)} - emprestimos {brl(debt.loans, 0)}</small></div>
          <div><span>Liquido sem bens</span><b>{brl(fin0 - debt.total)}</b><small className="muted">{s.bens > 0 ? `com bens: ${brl(fin0 + s.bens - debt.total)}` : "tem - deve"}</small></div>
        </div>
        <p className="muted small">Aqui so se ve: para lancar ou alterar qualquer coisa (conta, investimento, cartao, emprestimo, fixo), use Lancamentos
          ou o link &quot;alterar&quot; de cada item.
          A cripto fica na aba Carteira{crypto > 0 ? ` (${brl(crypto, 0)})` : ""}; o patrimonio total da Visao geral soma tudo.</p>
      </section>

      <h3 className="bal-title">O que voce tem</h3>
      <section className="card">
        <div className="card-head"><h2>Contas</h2><span className="muted small">{brl(acct?.value ?? 0)}</span></div>
        <AccountsPanel months={months} setup={setup} m={mon.m} onEdit={(id) => goEdit("conta", id)} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Investimentos</h2>
          <button className="link" onClick={() => goEdit("inv", null)}>+ investimento</button>
        </div>
        {invRows.length ? (
          <div className="table-scroll">
            <table className="stack fin">
              <thead><tr><th>Investimento</th><th>Quantidade</th><th>Preco</th><th>Valor</th><th>Lucro</th><th>Rende/mes</th><th /></tr></thead>
              <tbody>
                {invRows.map((r) => <ItemRow key={r.item.id} r={r} onEdit={() => goEdit("inv", r.item.id)} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nenhum investimento cadastrado. Em Lancamentos, escolha &quot;Investimento&quot; para incluir cofrinho, Tesouro, acoes ou FIIs.</p>
        )}
        <p className="muted small">
          Automatico: cotacao e proventos (Yahoo Finance), preco do Tesouro (Tesouro Transparente, 1 vez por dia), CDI, IPCA e dolar
          (Banco Central). A mao: quantidades, saldo do cofrinho e precos medios, porque bancos e a B3 nao tem API aberta para ler sua
          posicao. Valores brutos, antes de IR e taxas.
        </p>
      </section>

      <Dividends rows={s.rows} fin={fin} />

      <section className="card">
        <div className="card-head"><h2>Bens</h2><span className="muted small">{brl(s.bens)}<button className="link" onClick={() => goEdit("bem", null)}>+ bem</button></span></div>
        {bemRows.length ? (
          <ul className="pend small">
            {bemRows.map((r) => (
              <li key={r.item.id}>
                <b>{r.item.name}</b> <span className="tag">{r.kindLabel}</span>
                <span className="muted">{r.note}{r.cost !== null && r.value !== null ? ` - pagou ${brl(r.cost, 0)}` : ""}</span>
                <span className={r.item.ignore ? "muted" : ""}>{r.value !== null ? brl(r.value, 0) : "-"}</span>
                <button className="link" onClick={() => goEdit("bem", r.item.id)}>alterar</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Nenhum bem cadastrado. Imoveis, terrenos e veiculos entram no patrimonio &quot;com bens&quot;, separados do financeiro.</p>}
      </section>

      <h3 className="bal-title">O que voce deve</h3>
      <DebtsBlock months={months} setup={setup} onEdit={(t, id) => goEdit(t, id)} />

      <h3 className="bal-title">Compromissos todo mes</h3>
      <Fixos setup={setup} onEdit={(id) => goEdit("fixo", id)} />
      </>}
    </>
  );
}

function ItemRow({ r, onEdit }: { r: FinRow; onEdit: () => void }) {
  const it = r.item;
  const qty = it.kind === "caixa" ? (it.balance !== undefined ? `saldo ${brl(it.balance)}` : "-")
    : it.kind === "outro" ? "-" : (it.qty ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  const gain = r.cost !== null && r.value !== null ? r.value - r.cost : null;
  return (
    <tr>
      <td>
        <i className={`dot g-${r.group}`} aria-hidden="true" /><b>{it.name}</b> <span className="tag">{r.kindLabel}</span>
        {it.reserva && <span className="tag">reserva</span>}
        <div className="muted small">{r.note || r.problem}</div>
      </td>
      <td data-label="Quantidade">{qty}</td>
      <td data-label="Preco">{r.price !== null ? <span className="cell">{brl(r.price)}{r.change !== null && <small className={pnlClass(r.change)}>{r.change > 0 ? "+" : ""}{pctS(r.change)} hoje</small>}</span> : "-"}</td>
      <td data-label="Valor"><b>{r.value !== null ? brl(r.value) : "-"}</b></td>
      <td data-label="Lucro" className={gain !== null ? pnlClass(gain) : "muted"}>
        {gain !== null ? <span className="cell">{signed(gain)}{r.cost! > 0 && <small>{pctS(gain / r.cost!)}</small>}</span> : it.kind === "outro" ? "-" : "informe o preco medio"}
      </td>
      <td data-label="Rende/mes">{r.monthly !== null ? <span className="cell">{brl(r.monthly)}{r.yieldYear !== null && <small className="muted">{pctS(r.yieldYear)} ao ano</small>}</span> : "-"}</td>
      <td className="actions">
        <button className="link" onClick={onEdit}>alterar</button>
      </td>
    </tr>
  );
}

// Formulario de inclusao/edicao: os campos mudam com o tipo
function ItemForm({ initial, fin, onSave, onCancel, only }: {
  initial: FinItem | null; fin: FinanceDoc | null; onSave: (it: FinItem) => void; onCancel: () => void; only?: FinKind;
}) {
  const [kind, setKind] = useState<FinKind>(only ?? initial?.kind ?? "caixa");
  const [bemType, setBemType] = useState<NonNullable<FinItem["bemType"]>>(initial?.bemType ?? "imovel");
  const [paid, setPaid] = useState(initial?.paid !== undefined ? String(initial.paid).replace(".", ",") : "");
  const [rate, setRate] = useState(initial?.rate !== undefined ? String(initial.rate).replace(".", ",") : "");
  const [counts, setCounts] = useState(!initial?.ignore);
  const [name, setName] = useState(initial?.name ?? "");
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [qty, setQty] = useState(initial?.qty !== undefined ? String(initial.qty).replace(".", ",") : "");
  const [avg, setAvg] = useState(initial?.avg !== undefined ? String(initial.avg).replace(".", ",") : "");
  const [balance, setBalance] = useState(initial?.balance !== undefined ? String(initial.balance).replace(".", ",") : "");
  const [balanceAt, setBalanceAt] = useState(new Date(initial?.balanceAt ?? Date.now() - 3 * 3_600_000).toISOString().slice(0, 10));
  const [cdiPct, setCdiPct] = useState(String(initial?.cdiPct ?? 100));
  const [value, setValue] = useState(initial?.value !== undefined ? String(initial.value).replace(".", ",") : "");
  const [reserva, setReserva] = useState(initial?.reserva ?? (initial ? false : true));
  const [err, setErr] = useState("");
  // Mais comuns primeiro, agrupados por tipo e em ordem de vencimento
  const rank = (id: string) => ["Tesouro Selic|", "Tesouro Prefixado|", "Tesouro IPCA+|", "Tesouro Prefixado com", "Tesouro IPCA+ com", "Tesouro Renda", "Tesouro Educa"]
    .findIndex((p) => id.startsWith(p)) + 1 || 99;
  const opts = tesouroOptions(fin).sort((a, b) => rank(a.id) - rank(b.id) || a.id.split("|")[0].localeCompare(b.id.split("|")[0]) || a.sort.localeCompare(b.sort));
  const groups = [...new Set(opts.map((o) => o.id.split("|")[0]))];
  const missing = title && !opts.some((o) => o.id === title);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = initial?.id ?? Math.random().toString(36).slice(2, 10);
    const base = { id, kind };
    let it: FinItem;
    if (kind === "caixa") {
      if (!(parse(balance) >= 0) || !balance) return setErr("Informe o saldo.");
      it = { ...base, name: name.trim() || "Cofrinho", balance: parse(balance), balanceAt: Date.parse(`${balanceAt}T12:00:00-03:00`),
        cdiPct: parse(cdiPct) || 100, reserva };
    } else if (kind === "tesouro") {
      if (!title) return setErr("Escolha o titulo.");
      if (!(parse(qty) > 0)) return setErr("Informe a quantidade de titulos (ex.: 0,35).");
      it = { ...base, name: title.replace("|", " ").replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3"), title, qty: parse(qty), reserva,
        ...(parse(avg) > 0 ? { avg: parse(avg) } : {}) };
    } else if (kind === "acao") {
      const tk = ticker.trim().toUpperCase().replace(/\.SA$/, "");
      if (!/^[A-Z0-9]{4,7}$/.test(tk)) return setErr("Codigo invalido (ex.: TAEE11, ITSA4, MXRF11, IVVB11).");
      if (!(parse(qty) > 0)) return setErr("Informe a quantidade.");
      it = { ...base, name: tk, ticker: tk, qty: parse(qty), ...(parse(avg) > 0 ? { avg: parse(avg) } : {}) };
    } else if (kind === "bem") {
      if (!name.trim()) return setErr("De um nome (ex.: Apartamento, Terreno Criciuma, Carro).");
      if (!(parse(value) > 0)) return setErr("Informe o valor estimado de hoje.");
      const r = rate.trim() ? Number(rate.replace(/\s/g, "").replace(",", ".").replace(/[\u2212]/g, "-")) : NaN;
      // mantem a data do valor se ele nao mudou (para a depreciacao seguir contando)
      const valueAt = initial?.kind === "bem" && initial.value === parse(value) && initial.valueAt ? initial.valueAt : Date.now();
      it = { ...base, name: name.trim(), bemType, value: parse(value), valueAt, ...(parse(paid) > 0 ? { paid: parse(paid) } : {}),
        ...(Number.isFinite(r) && r !== 0 ? { rate: r } : {}), ...(counts ? {} : { ignore: true }) };
    } else {
      if (!name.trim()) return setErr("De um nome (ex.: Previdencia, Poupanca).");
      it = { ...base, name: name.trim(), value: parse(value), valueAt: Date.now(), reserva };
    }
    onSave(it);
  };

  return (
    <form className="fin-form" onSubmit={submit}>
      {!only && <div className="kind-pick" role="radiogroup" aria-label="Tipo">
        {KINDS.map((k) => (
          <button type="button" key={k.key} role="radio" aria-checked={kind === k.key} className={kind === k.key ? "pill on" : "pill"}
            onClick={() => { setKind(k.key); setErr(""); }} disabled={!!initial && initial.kind !== k.key}>{k.label}</button>
        ))}
      </div>}
      {kind !== "bem" && <p className="muted small">{KINDS.find((k) => k.key === kind)?.hint}</p>}
      {kind === "bem" && <p className="muted small">Imovel, terreno, veiculo: entra no patrimonio &quot;com bens&quot;, separado do patrimonio financeiro.</p>}
      <div className="row wrapline">
        {(kind === "caixa" || kind === "outro") && (
          <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "caixa" ? "Cofrinho do banco" : "Previdencia"} /></label>
        )}
        {kind === "caixa" && (
          <>
            <label>Saldo hoje (R$)<input value={balance} inputMode="decimal" onChange={(e) => setBalance(e.target.value)} placeholder="5.000,00" /></label>
            <label>Data do saldo<input type="date" value={balanceAt} onChange={(e) => setBalanceAt(e.target.value)} /></label>
            <label>% do CDI<input value={cdiPct} inputMode="decimal" onChange={(e) => setCdiPct(e.target.value)} /></label>
            <p className="muted small full">Depositos e resgates lancados em Lancamentos (categoria Investimento) depois dessa data somam
              e descontam sozinhos. Ao atualizar o saldo, use a data de hoje.</p>
          </>
        )}
        {kind === "tesouro" && (
          <>
            <label className="grow">Titulo
              <select value={title} onChange={(e) => setTitle(e.target.value)}>
                <option value="">{opts.length ? "escolha..." : "lista carrega no Atualizar tudo"}</option>
                {missing && <option value={title}>{title.replace("|", " ")}</option>}
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {opts.filter((o) => o.id.split("|")[0] === g).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Quantidade de titulos<input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} placeholder="0,35" /></label>
            <label>Preco medio por titulo (R$, opcional)<input value={avg} inputMode="decimal" onChange={(e) => setAvg(e.target.value)} /></label>
          </>
        )}
        {kind === "acao" && (
          <>
            <label>Codigo<input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="TAEE11" autoCapitalize="characters" /></label>
            <label>Quantidade<input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} /></label>
            <label>Preco medio (R$, opcional)<input value={avg} inputMode="decimal" onChange={(e) => setAvg(e.target.value)} /></label>
          </>
        )}
        {kind === "outro" && (
          <label>Valor hoje (R$)<input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} /></label>
        )}
        {kind === "bem" && (
          <>
            <label>Tipo
              <select value={bemType} onChange={(e) => setBemType(e.target.value as NonNullable<FinItem["bemType"]>)}>
                <option value="imovel">Imovel</option><option value="terreno">Terreno</option><option value="veiculo">Veiculo</option><option value="outro">Outro bem</option>
              </select>
            </label>
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder={bemType === "veiculo" ? "Carro, moto..." : "Apartamento, casa..."} /></label>
            <label>{initial?.kind === "bem" && initial.valueAt && parse(value) === initial.value
              ? `Valor estimado em ${new Date(initial.valueAt).toLocaleDateString("pt-BR")} (R$; mude para atualizar hoje)`
              : "Valor estimado hoje (R$)"}<input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} placeholder="ex.: 250.000" /></label>
            <label>Quanto pagou (R$, opcional)<input value={paid} inputMode="decimal" onChange={(e) => setPaid(e.target.value)} /></label>
            <label>Valoriza/deprecia % ao ano (opcional)<input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder={bemType === "veiculo" ? "ex.: -10" : "ex.: 4"} /></label>
          </>
        )}
      </div>
      {kind === "bem" && (
        <label className="check"><input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} /> Contar no patrimonio (desmarque para so registrar)</label>
      )}
      {kind !== "acao" && kind !== "bem" && (
        <label className="check"><input type="checkbox" checked={reserva} onChange={(e) => setReserva(e.target.checked)} />
          Faz parte da reserva de emergencia (dinheiro que pode sacar a qualquer hora)</label>
      )}
      {err && <p className="error small">{err}</p>}
      <div className="row">
        <button type="submit" className="primary">{initial ? "Salvar" : "Adicionar"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}


// Barra 100%: patrimonio por grupo (cor fixa por grupo)
function FinBar({ byGroup }: { byGroup: Record<FinGroup, number> }) {
  const [hover, setHover] = useState<FinGroup | null>(null);
  // Bens ficam fora da barra (aparecem numa linha separada)
  const parts = GROUPS.filter((g) => g.key !== "bens").map((g) => ({ ...g, value: Math.max(0, byGroup[g.key]) })).filter((g) => g.value > 0.005);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return null;
  const W = 640;
  const GAP = 2;
  const usable = W - GAP * (parts.length - 1);
  let x = 0;
  const segs = parts.map((p) => {
    const w = Math.max(2, (p.value / total) * usable);
    const seg = { ...p, x, w, pct: p.value / total };
    x += w + GAP;
    return seg;
  });
  const hov = segs.find((g) => g.key === hover);
  return (
    <figure className="viz">
      <figcaption className="small muted">Onde esta o dinheiro {hov ? `- ${hov.label}: ${brl(hov.value)} (${pctS(hov.pct)})` : ""}</figcaption>
      <svg viewBox={`0 0 ${W} 22`} preserveAspectRatio="none" className="alloc" role="img" aria-label="Patrimonio por grupo" onMouseLeave={() => setHover(null)}>
        {segs.map((g) => (
          <rect key={g.key} x={g.x} y={0} width={g.w} height={22} rx={4} className={`g-${g.key}${hover && hover !== g.key ? " dim" : ""}`}
            onMouseEnter={() => setHover(g.key)}>
            <title>{`${g.label}: ${brl(g.value)} (${pctS(g.pct)})`}</title>
          </rect>
        ))}
      </svg>
      <ul className="viz-legend small">
        {segs.map((g) => (
          <li key={g.key} onMouseEnter={() => setHover(g.key)} onMouseLeave={() => setHover(null)}>
            <i className={`g-${g.key}`} />{g.label} <b>{pctS(g.pct)}</b> <span className="muted">{brl(g.value, 0)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// Proventos: quanto cada papel pagou por cota em 12 meses e o que isso daria com a quantidade atual
function Dividends({ rows, fin }: { rows: FinRow[]; fin: FinanceDoc | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const papers = rows.filter((r) => r.item.kind === "acao" && fin?.quotes?.[(r.item.ticker ?? "").toUpperCase()]);
  if (!papers.length) return null;
  const now = new Date();
  // Ultimos 12 meses (data ex do provento), com a quantidade de hoje
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), year: d.getFullYear(), v: 0 };
  });
  const list = papers.map((r) => {
    const q = fin!.quotes[(r.item.ticker ?? "").toUpperCase()];
    const last12 = q.divs.filter((d) => d.t > Date.now() - 365 * 86_400_000);
    for (const d of last12) {
      const dt = new Date(d.t);
      const m = months.find((x) => x.key === `${dt.getFullYear()}-${dt.getMonth()}`);
      if (m) m.v += d.v * (r.item.qty ?? 0);
    }
    const per = last12.reduce((s, d) => s + d.v, 0);
    return { r, q, per, count: last12.length, last: q.divs[q.divs.length - 1] };
  }).sort((a, b) => b.per * (b.r.item.qty ?? 0) - a.per * (a.r.item.qty ?? 0));
  const paying = list.filter((x) => x.per > 0);
  const none = list.filter((x) => !(x.per > 0)).map((x) => x.r.item.ticker);
  const max = Math.max(...months.map((m) => m.v), 0);
  const year = months.reduce((s, m) => s + m.v, 0);
  const hov = hover !== null ? months[hover] : null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Proventos</h2>
        <span className="muted small">{brl(year)} em 12 meses com a quantidade de hoje - ~{brl(year / 12)}/mes</span>
      </div>
      {max > 0 && (
        <figure className="viz">
          <figcaption className="small muted">Por mes (data com) {hov ? `- ${hov.label}/${hov.year}: ${brl(hov.v)}` : ""}</figcaption>
          <div className="mbars" onMouseLeave={() => setHover(null)}>
            {months.map((m, i) => (
              <div key={m.key} className={`mbar${hover !== null && hover !== i ? " dim" : ""}`} onMouseEnter={() => setHover(i)} title={`${m.label}/${m.year}: ${brl(m.v)}`}>
                <span className="mbar-fill" style={{ height: `${max > 0 ? (m.v / max) * 100 : 0}%` }} />
                <small>{m.label}</small>
              </div>
            ))}
          </div>
        </figure>
      )}
      <div className="table-scroll">
        <table className="stack divs">
          <thead><tr><th>Papel</th><th>Por cota (12 m)</th><th>Dividend yield</th><th>Pagamentos</th><th>Ultimo</th><th>Voce receberia/ano</th></tr></thead>
          <tbody>
            {paying.map(({ r, per, count, last }) => (
              <tr key={r.item.id}>
                <td><b>{r.item.ticker}</b> <span className="tag">{r.kindLabel}</span><div className="muted small">{short(fin!.quotes[(r.item.ticker ?? "").toUpperCase()].name)}</div></td>
                <td data-label="Por cota (12 m)">{per > 0 ? brl(per, 4) : "-"}</td>
                <td data-label="Dividend yield">{r.yieldYear !== null ? pctS(r.yieldYear) : "-"}</td>
                <td data-label="Pagamentos">{count}</td>
                <td data-label="Ultimo">{last ? <span className="cell">{new Date(last.t).toLocaleDateString("pt-BR")}<small className="muted">{brl(last.v, 4)} por cota</small></span> : "-"}</td>
                <td data-label="Voce receberia/ano"><b>{brl(per * (r.item.qty ?? 0))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {none.length > 0 && <p className="muted small">Sem proventos nos ultimos 12 meses: {none.join(", ")}.</p>}
      <p className="muted small">
        Proventos = dividendos + JCP, por data com (Yahoo Finance; JCP aparece bruto, antes dos 15% de IR). Dividend yield alto sozinho
        nao diz muito: muitas vezes vem de uma acao que caiu. Olhe a constancia dos pagamentos ao longo dos anos.
      </p>
    </section>
  );
}

// ---------- blocos da Visao geral ----------
type Ctx = {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; spend: { value: number; months: number } | null;
  debt: { total: number; loans: number; cards: number }; months: Record<string, MonthDoc>; setup: GastosSetup;
};

// Patrimonio: liquido, reserva, rendimento, lucro e onde esta o dinheiro
export function PatrimonioCard({ cfg, fin, wallet, spend, debt, months, setup, onBens }: Ctx & { onBens: () => void }) {
  const items = cfg.finance ?? [];
  const acct = accountBalance(months, setup);
  const s = financeSummary(items, fin, wallet, spend?.value ?? cfg.monthlyCost, acct?.value, investFlows(months));
  const notices = s.rows.flatMap((r) => [r.stale, r.problem].filter(Boolean).map((t) => `${r.item.name}: ${t}`));
  const cdi = cdiYear(fin);
  return (
      <section className="card">
        <div className="card-head">
          <h2>Patrimonio</h2>
          <button className="link" onClick={onBens}>ver contas e bens &rsaquo;</button>
        </div>
        <div className="kpis">
          <div><span>{s.bens > 0 ? "Patrimonio sem bens" : debt.total > 0 ? "Patrimonio liquido" : "Patrimonio total"}</span><b>{brl(s.totalNoBens - debt.total)}</b>
            <small className="muted">{debt.total > 0 ? `${brl(s.totalNoBens, 0)} - ${brl(debt.total, 0)} de dividas` : s.usd ? `~US$ ${fmt(s.total / s.usd)} - cripto incluida` : wallet ? "falta o dolar: clique em Atualizar tudo" : "sem carteiras cripto"}</small></div>
          {s.bens > 0 && <div><span>Patrimonio com bens</span><b>{brl(s.total - debt.total)}</b>
            <small className="muted">+ {brl(s.bens, 0)} em imoveis, veiculos...</small></div>}
          <div><span>Reserva de emergencia</span><b>{brl(s.reserve)}</b>
            <small className="muted">{s.reserveMonths !== null ? `cobre ${fmt(s.reserveMonths, 1)} meses de gastos` : "a media de gastos aparece depois do 1o mes completo de lancamentos"}{spend ? ` (media de ${spend.months} ${spend.months > 1 ? "meses" : "mes"})` : ""}</small></div>
          <div><span>Rende por mes (estimado)</span><b>{brl(s.monthly)}</b>
            <small className="muted">{s.dividends > 0 ? `${brl(s.dividends)} de proventos` : "juros + proventos, antes de IR"}</small></div>
          <div><span>Lucro / prejuizo</span><b className={pnlClass(s.gain)}>{s.cost > 0 ? signed(s.gain) : "-"}</b>
            <small className="muted">{s.cost > 0 ? `${pctS(s.gain / s.cost)} sobre ${brl(s.cost)} (fora cripto)` : "informe precos medios"}</small></div>
        </div>
        <p className="muted small indic">
          {cdi !== null && <span>CDI {pctS(cdi, 2)} ao ano</span>}
          {fin?.ipca12m != null && <span>IPCA 12 m {pctS(fin.ipca12m, 2)} ({fin.ipcaRef})</span>}
          {fin?.usdbrl && <span>Dolar R$ {fmt(fin.usdbrl, 4)} (PTAX)</span>}
          {spend && <span>Gasto medio {brl(spend.value, 0)}/mes</span>}
          {fin && <span>dados de {new Date(fin.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
        </p>
        <FinBar byGroup={s.byGroup} />
        {s.bens > 0 && <p className="small muted">Fora da barra: bens {brl(s.bens, 0)} ({s.rows.filter((r) => r.item.kind === "bem" && !r.item.ignore).map((r) => r.item.name).join(", ")}).</p>}
        {(notices.length > 0 || (fin?.errors.length ?? 0) > 0) && (
          <ul className="alerts small">
            {notices.map((n) => <li key={n} className="warn">{n}</li>)}
            {fin?.errors.map((e) => <li key={e} className="error">Fonte de dados: {e}</li>)}
          </ul>
        )}
      </section>
  );
}

// O mes (entrou/saiu/sobrou/em conta) + proximos pagamentos em 30 dias
export function MonthAndUpcoming({ months, setup, onLanc, onBens }: { months: Record<string, MonthDoc>; setup: GastosSetup; onLanc: () => void; onBens: () => void }) {
  const mon = monthSnapshot(months, setup);
  const acct = accountBalance(months, setup);
  const next = upcoming(months, setup);
  return (
      <div className="two-col">
        <section className="card link-card" role="button" tabIndex={0} onClick={onLanc}>
          <div className="card-head"><h2>{monthLabel(mon.m, true)}</h2><span className="muted small">ver lancamentos &rsaquo;</span></div>
          {mon.count || mon.pendingN ? (
            <div className="kpis compact">
              <div><span>Entrou</span><b>{brl(mon.receitas, 0)}</b></div>
              <div><span>Saiu (gastos)</span><b>{brl(mon.gastos, 0)}</b><small className="muted">{mon.avg ? `media ${brl(mon.avg.value, 0)}` : ""}</small></div>
              <div><span>Sobrou</span><b className={mon.receitas - mon.gastos >= 0 ? "pos" : "neg"}>{brl(mon.receitas - mon.gastos, 0)}</b></div>
              <div><span>Em conta</span><b className={acct && acct.value < 0 ? "neg" : ""}>{acct ? brl(acct.value, 0) : "-"}</b>
                <small className={acct && !acct.informed ? "warn" : "muted"}>{acct ? (acct.informed ? "saldo das contas" : "confira o saldo") : ""}</small></div>
            </div>
          ) : <p className="muted small">Nada lancado neste mes. Em Lancamentos, importe o extrato do banco ou lance a mao.</p>}
        </section>
        <section className="card">
          <div className="card-head"><h2>Proximos pagamentos</h2><button className="link" onClick={onBens}>30 dias &rsaquo;</button></div>
          {next.length ? (
            <ul className="pend small">
              {next.slice(0, 7).map((p, i) => (
                <li key={i}><span className={p.late ? "warn" : "muted"}>{dm(p.d)}</span> <b>{p.desc}</b> <span className={p.late ? "warn" : ""}>{brl(p.v)}</span></li>
              ))}
              {next.length > 7 && <li className="muted">+ {next.length - 7}</li>}
            </ul>
          ) : <p className="muted small">Nada a pagar nos proximos 30 dias (cadastre cartoes, emprestimos e fixos em Contas e bens).</p>}
        </section>
      </div>
  );
}

export function NetWorthBlock({ cfg, fin, wallet, months, setup, nwHist }: Ctx & { nwHist: NetWorthDoc[] }) {
  return <NetWorthChart hist={nwHist} live={netWorth(cfg, fin, wallet, months, setup)} />;
}

// ---------- "O que voce quer lancar?" (unico lugar de entrada) ----------
export type EntryType = "mov" | "import" | "inv" | "bem" | "fixo" | "conta";
const ENTRY_TYPES: { id: EntryType; label: string }[] = [
  { id: "mov", label: "Gasto ou entrada" }, { id: "import", label: "Importar extrato" }, { id: "inv", label: "Investimento" }, { id: "bem", label: "Bem (imovel, veiculo)" },
  { id: "fixo", label: "Gasto fixo" }, { id: "conta", label: "Conta / saldo" },
];

function EntryPanel({ entry, setEntry, months, setup, invest, fin, onSaveInv, onRemoveInv }: {
  entry: { type: EntryType; id: string | null }; setEntry: (e: { type: EntryType; id: string | null }) => void;
  months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[]; fin: FinanceDoc | null;
  onSaveInv: (it: FinItem) => void; onRemoveInv: (it: FinItem) => void;
}) {
  const { type, id } = entry;
  const reset = () => setEntry({ type, id: null });
  const accounts = accountsOf(setup);
  // Itens existentes de cada tipo (para alterar ou remover)
  const existing: Record<string, { id: string; label: string }[]> = {
    inv: invest.filter((i) => i.kind !== "bem").map((i) => ({ id: i.id, label: i.name })),
    bem: invest.filter((i) => i.kind === "bem").map((i) => ({ id: i.id, label: i.name })),
    fixo: setup.fixos.map((f) => ({ id: f.id, label: f.desc })),
    conta: accounts.map((a) => ({ id: a.id, label: a.name })),
  };
  const opts = existing[type];
  const saveAccounts = async (list: Account[]) => { await saveSetup({ accounts: JSON.parse(JSON.stringify(list)), account: null } as Partial<GastosSetup>); reset(); };
  const usedAcc = new Set(Object.values(months).flatMap((md) => md.items.map((g) => g.acc ?? (g.card ? "" : accounts[0].id))));
  return (
    <div className="entry">
      <p className="small entry-q">O que voce quer lancar? <span className="muted">(compras no cartao e emprestimos: em Cartoes e emprestimos)</span></p>
      <div className="kind-pick entry-types">
        {ENTRY_TYPES.map((t) => (
          <button key={t.id} type="button" className={type === t.id ? "pill on" : "pill"} onClick={() => setEntry({ type: t.id, id: null })}>{t.label}</button>
        ))}
      </div>
      {opts && (
        <label className="entry-pick small">Novo ou alterar:
          <select value={id ?? ""} onChange={(e) => setEntry({ type, id: e.target.value || null })}>
            <option value="">+ novo</option>
            {opts.map((o) => <option key={o.id} value={o.id}>alterar: {o.label}</option>)}
          </select>
        </label>
      )}
      {type === "mov" && <QuickAdd months={months} setup={setup} invest={invest} defaultDate={todayBR()} />}
      {type === "import" && <ImportPanel months={months} setup={setup} invest={invest} onDone={() => setEntry({ type: "mov", id: null })} />}
      {type === "inv" && (
        <>
          <ItemForm key={id ?? "novo"} initial={invest.find((i) => i.id === id) ?? null} fin={fin} onSave={onSaveInv} onCancel={reset} />
          {id && <button className="ghost small-btn" onClick={() => { const it = invest.find((i) => i.id === id); if (it) onRemoveInv(it); }}>remover este investimento</button>}
        </>
      )}
      {type === "bem" && (
        <>
          <ItemForm key={id ?? "novo-bem"} only="bem" initial={invest.find((i) => i.id === id) ?? null} fin={fin} onSave={(it) => { onSaveInv(it); setEntry({ type: "bem", id: null }); }} onCancel={reset} />
          {id && <button className="ghost small-btn" onClick={() => { const it = invest.find((i) => i.id === id); if (it) { onRemoveInv(it); setEntry({ type: "bem", id: null }); } }}>remover este bem</button>}
        </>
      )}
      {type === "fixo" && <FixoForm key={id ?? "novo"} setup={setup} fixo={setup.fixos.find((f) => f.id === id) ?? null} onDone={reset} />}
      {type === "conta" && (
        <AccountForm key={id ?? "novo"} acc={accounts.find((a) => a.id === id) ?? null}
          canRemove={!!id && accounts.length > 1 && !usedAcc.has(id)}
          onCancel={reset}
          onRemove={() => saveAccounts(accounts.filter((a) => a.id !== id))}
          onSave={(a) => saveAccounts(accounts.some((x) => x.id === a.id) ? accounts.map((x) => (x.id === a.id ? a : x)) : [...accounts, a])} />
      )}
    </div>
  );
}
