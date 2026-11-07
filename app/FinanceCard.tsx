"use client";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import { GROUPS, cdiYear, financeSummary, tesouroOptions, type FinGroup, type FinRow } from "@/lib/financeMath";
import type { AppConfig, FinanceDoc, FinItem, FinKind, WalletDoc } from "@/lib/types";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
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
export default function FinanceCard({ cfg, fin, wallet, onChanged }: {
  cfg: AppConfig; fin: FinanceDoc | null; wallet: WalletDoc | null; onChanged: () => void;
}) {
  const items = cfg.finance ?? [];
  const s = financeSummary(items, fin, wallet, cfg.monthlyCost);
  const [editing, setEditing] = useState<FinItem | null>(null);
  const [adding, setAdding] = useState(false);

  async function save(list: FinItem[], fetchQuotes: boolean) {
    await setDoc(doc(db(), "config/main"), { finance: JSON.parse(JSON.stringify(list)) }, { merge: true });
    if (fetchQuotes) onChanged();
  }
  const upsert = async (it: FinItem) => {
    const list = items.some((x) => x.id === it.id) ? items.map((x) => (x.id === it.id ? it : x)) : [...items, it];
    setEditing(null);
    setAdding(false);
    await save(list, it.kind === "acao" || it.kind === "tesouro");
  };
  const remove = async (it: FinItem) => {
    if (!confirm(`Remover "${it.name}" da lista? (so tira do site, nao mexe no investimento)`)) return;
    await save(items.filter((x) => x.id !== it.id), false);
  };

  const order = GROUPS.map((g) => g.key);
  const rows = [...s.rows].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (b.value ?? 0) - (a.value ?? 0));
  const notices = rows.flatMap((r) => [r.stale, r.problem].filter(Boolean).map((t) => `${r.item.name}: ${t}`));
  const cdi = cdiYear(fin);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Patrimonio total</h2>
          <span className="muted small">{fin ? `dados de ${new Date(fin.at).toLocaleString("pt-BR")}` : "indices ainda nao carregados"}</span>
        </div>
        <div className="kpis">
          <div><span>Patrimonio total</span><b>{brl(s.total)}</b>
            <small className="muted">{s.usd ? `~US$ ${fmt(s.total / s.usd)} - cripto incluida` : wallet ? "falta o dolar: clique em Atualizar tudo" : "sem carteiras cripto"}</small></div>
          <div><span>Reserva de emergencia</span><b>{brl(s.reserve)}</b>
            <small className="muted">{s.reserveMonths !== null ? `cobre ${fmt(s.reserveMonths, 1)} meses de gastos` : "informe o gasto mensal abaixo"}</small></div>
          <div><span>Rende por mes (estimado)</span><b>{brl(s.monthly)}</b>
            <small className="muted">{s.dividends > 0 ? `${brl(s.dividends)} de proventos` : "juros + proventos, antes de IR"}</small></div>
          <div><span>Lucro / prejuizo</span><b className={pnlClass(s.gain)}>{s.cost > 0 ? signed(s.gain) : "-"}</b>
            <small className="muted">{s.cost > 0 ? `${pctS(s.gain / s.cost)} sobre ${brl(s.cost)} (fora cripto)` : "informe precos medios"}</small></div>
        </div>
        <p className="muted small indic">
          {cdi !== null && <span>CDI {pctS(cdi, 2)} ao ano</span>}
          {fin?.ipca12m != null && <span>IPCA 12 m {pctS(fin.ipca12m, 2)} ({fin.ipcaRef})</span>}
          {fin?.usdbrl && <span>Dolar R$ {fmt(fin.usdbrl, 4)} (PTAX)</span>}
          <MonthlyCost value={cfg.monthlyCost} />
        </p>
        <FinBar byGroup={s.byGroup} />
        {(notices.length > 0 || (fin?.errors.length ?? 0) > 0) && (
          <ul className="alerts small">
            {notices.map((n) => <li key={n} className="warn">{n}</li>)}
            {fin?.errors.map((e) => <li key={e} className="error">Fonte de dados: {e}</li>)}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Investimentos</h2>
          {!adding && !editing && <button onClick={() => setAdding(true)}>+ Adicionar</button>}
        </div>
        {(adding || editing) && (
          <ItemForm key={editing?.id ?? "novo"} initial={editing} fin={fin} onSave={upsert} onCancel={() => { setAdding(false); setEditing(null); }} />
        )}
        {rows.length ? (
          <div className="table-scroll">
            <table className="stack fin">
              <thead><tr><th>Investimento</th><th>Quantidade</th><th>Preco</th><th>Valor</th><th>Lucro</th><th>Rende/mes</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => <ItemRow key={r.item.id} r={r} onEdit={() => { setAdding(false); setEditing(r.item); }} onRemove={() => remove(r.item)} />)}
              </tbody>
            </table>
          </div>
        ) : !adding && (
          <p className="muted">Nenhum investimento cadastrado. Clique em &quot;+ Adicionar&quot; para incluir cofrinho, Tesouro, acoes ou FIIs.</p>
        )}
        <p className="muted small">
          Automatico: cotacao e proventos (Yahoo Finance), preco do Tesouro (Tesouro Transparente, 1 vez por dia), CDI, IPCA e dolar
          (Banco Central). A mao: quantidades, saldo do cofrinho e precos medios, porque bancos e a B3 nao tem API aberta para ler sua
          posicao. Valores brutos, antes de IR e taxas.
        </p>
      </section>

      <Dividends rows={s.rows} fin={fin} />
    </>
  );
}

function ItemRow({ r, onEdit, onRemove }: { r: FinRow; onEdit: () => void; onRemove: () => void }) {
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
        <button className="ghost small-btn" onClick={onEdit}>editar</button>
        <button className="ghost small-btn" onClick={onRemove}>remover</button>
      </td>
    </tr>
  );
}

// Formulario de inclusao/edicao: os campos mudam com o tipo
function ItemForm({ initial, fin, onSave, onCancel }: {
  initial: FinItem | null; fin: FinanceDoc | null; onSave: (it: FinItem) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<FinKind>(initial?.kind ?? "caixa");
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
    } else {
      if (!name.trim()) return setErr("De um nome (ex.: Previdencia, Poupanca).");
      it = { ...base, name: name.trim(), value: parse(value), valueAt: Date.now(), reserva };
    }
    onSave(it);
  };

  return (
    <form className="fin-form" onSubmit={submit}>
      <div className="kind-pick" role="radiogroup" aria-label="Tipo">
        {KINDS.map((k) => (
          <button type="button" key={k.key} role="radio" aria-checked={kind === k.key} className={kind === k.key ? "pill on" : "pill"}
            onClick={() => { setKind(k.key); setErr(""); }} disabled={!!initial && initial.kind !== k.key}>{k.label}</button>
        ))}
      </div>
      <p className="muted small">{KINDS.find((k) => k.key === kind)!.hint}</p>
      <div className="row wrap">
        {(kind === "caixa" || kind === "outro") && (
          <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "caixa" ? "Cofrinho do banco" : "Previdencia"} /></label>
        )}
        {kind === "caixa" && (
          <>
            <label>Saldo hoje (R$)<input value={balance} inputMode="decimal" onChange={(e) => setBalance(e.target.value)} placeholder="5.000,00" /></label>
            <label>Data do saldo<input type="date" value={balanceAt} onChange={(e) => setBalanceAt(e.target.value)} /></label>
            <label>% do CDI<input value={cdiPct} inputMode="decimal" onChange={(e) => setCdiPct(e.target.value)} /></label>
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
      </div>
      {kind !== "acao" && (
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

// Gasto mensal (para medir a reserva em meses)
function MonthlyCost({ value }: { value?: number }) {
  const [text, setText] = useState(value ? fmt(value, 0) : "");
  const save = async () => {
    const v = parse(text);
    if (v === (value ?? 0)) return;
    await setDoc(doc(db(), "config/main"), { monthlyCost: v > 0 ? v : 0 }, { merge: true });
  };
  return (
    <label className="inline small">Gasto mensal R$
      <input value={text} inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="ex.: 4.000" />
    </label>
  );
}

// Barra 100%: patrimonio por grupo (cor fixa por grupo)
function FinBar({ byGroup }: { byGroup: Record<FinGroup, number> }) {
  const [hover, setHover] = useState<FinGroup | null>(null);
  const parts = GROUPS.map((g) => ({ ...g, value: Math.max(0, byGroup[g.key]) })).filter((g) => g.value > 0.005);
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
