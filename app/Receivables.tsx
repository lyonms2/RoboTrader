"use client";
import { useEffect, useRef, useState } from "react";
import {
  RECV_BACK_CAT, RECV_OUT_CAT, RECV_SALE_CAT, accountsOf, addMonths, descKey, fixoActive, fixoExpected, monthLabel, monthOf, newId, recvDue, recvLedger, recvStatus, todayBR,
  type Gasto, type GastosSetup, type LedgerEntry, type MonthDoc, type Recv, type RecvRow,
} from "@/lib/gastos";
import { CatSelect, saveMonth, saveSetup } from "./GastosCard";
import { ask, askText, tell } from "./Dialog";
import Note from "./Note";
void tell;

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$\u00a0${fmt(v, d)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const num = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
const SIT: Record<RecvRow["status"], { cls: string; label: string }> = {
  recebida: { cls: "paga", label: "recebida" }, atrasada: { cls: "atrasada", label: "atrasada" }, aberta: { cls: "aberta", label: "a receber" },
};

const saveRecvs = (list: Recv[]) => saveSetup({ recvs: JSON.parse(JSON.stringify(list)) });
// Lancamento da parcela recebida: emprestimo devolvido nao e renda; venda/servico e renda
export const recvItem = (r: Recv, k: number, v: number, d: string, acc?: string): Gasto => ({
  id: newId(), d, desc: `${r.name} (parcela ${k + 1}/${r.n})`, v,
  ...(r.kind === "emprestei" ? { tipo: "neutro" as const, io: "in" as const, cat: RECV_BACK_CAT } : { tipo: "receita" as const, cat: RECV_SALE_CAT }),
  src: "manual", ref: r.id, parc: [k + 1, r.n], ...(acc ? { acc } : {}),
});
// "Recebi": lanca a entrada na conta (ou so marca) e guarda na divida
export async function receive(r: Recv, k: number, v: number, d: string, acc: string | null, months: Record<string, MonthDoc>, setup: GastosSetup) {
  const get: NonNullable<Recv["gets"]>[number] = { k, d, v };
  if (acc) {
    const g = recvItem(r, k, v, d, acc);
    const gm = monthOf(d);
    await saveMonth(gm, [...(months[gm]?.items ?? []), g]);
    get.gid = g.id; get.gm = gm;
  }
  await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, gets: [...(x.gets ?? []).filter((y) => y.k !== k), get] } : x)));
}
// Liga um lancamento do extrato a uma parcela (e aprende a descricao para os proximos meses)
export async function linkRecv(r: Recv, k: number, g: Gasto, months: Record<string, MonthDoc>, setup: GastosSetup) {
  const gm = monthOf(g.d);
  const patch: Partial<Gasto> = r.kind === "emprestei" ? { cat: RECV_BACK_CAT, tipo: "neutro", io: "in" } : { tipo: "receita", cat: g.tipo === "receita" ? g.cat : RECV_SALE_CAT };
  await saveMonth(gm, (months[gm]?.items ?? []).map((x) => (x.id === g.id ? { ...x, ...patch, ref: r.id, parc: [k + 1, r.n] } : x)));
  const key = descKey(g.desc);
  if (key && !(r.keys ?? []).includes(key)) await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, keys: [...(x.keys ?? []), key] } : x)));
}

export default function ReceivablesPart({ months, setup, openId }: { months: Record<string, MonthDoc>; setup: GastosSetup; openId?: string | null }) {
  const today = todayBR();
  const list = (setup.recvs ?? []).map((r) => ({ r, st: recvStatus(r, months, today) }));
  const left = list.reduce((t, x) => t + x.st.leftV, 0);
  const got = list.reduce((t, x) => t + x.st.gotV, 0);
  const late = list.reduce((t, x) => t + x.st.late, 0);
  const lateV = list.reduce((t, x) => t + x.st.lateV, 0);
  const nx = list.filter((x) => x.st.next).sort((a, b) => a.st.next!.localeCompare(b.st.next!))[0];
  const [adding, setAdding] = useState(!list.length);
  return (
    <>
      <section className="card">
        <h2>A receber</h2>
        <div className="kpis">
          <div><span>Te devem</span><b className="pos">{brl(left)}</b><small className="muted">{list.filter((x) => x.st.leftV > 0).length} {list.filter((x) => x.st.leftV > 0).length === 1 ? "pessoa/dívida" : "pessoas/dívidas"} - entra no patrimônio</small></div>
          {late > 0 && <div><span>Parcelas atrasadas</span><b className="warn">{late} - {brl(lateV)}</b><small className="muted">venceram sem pagamento</small></div>}
          <div><span>Próxima a receber</span><b>{nx ? brl(nx.r.parcela) : "-"}</b>
            <small className="muted">{nx ? `${nx.r.name} ${nx.st.nextK! + 1}/${nx.r.n} - ${nx.st.next! < today ? "venceu" : "dia"} ${dm(nx.st.next!)}/${nx.st.next!.slice(2, 4)}` : "nenhuma"}</small></div>
          <div><span>Já recebido</span><b>{brl(got)}</b><small className="muted">soma das parcelas recebidas</small></div>
        </div>
        <Note>Pix com o nome da pessoa no extrato é reconhecido sozinho como parcela recebida. Recebeu e não aparece? Use &quot;recebi&quot;.
          Dinheiro que você emprestou volta como &quot;Devolução de empréstimo&quot; (não é renda); venda ou serviço parcelado entra como renda.</Note>
      </section>

      <section className="card">
        <div className="card-head"><h2>Quem te deve</h2>
          {!adding && <button className="ghost small-btn" onClick={() => setAdding(true)}>+ novo a receber</button>}</div>
        {adding && <div className="loan-form"><RecvForm months={months} setup={setup} onDone={() => setAdding(false)} /></div>}
        {list.map(({ r, st }) => r.kind === "conta"
          ? <ContaItem key={r.id} r={r} months={months} setup={setup} single={list.length === 1} initial={openId === r.id} />
          : <RecvItem key={r.id} r={r} st={st} months={months} setup={setup} single={list.length === 1} initial={openId === r.id} />)}
        {!list.length && !adding && <p className="muted small">Ninguém te deve nada cadastrado.</p>}
      </section>
    </>
  );
}

type RStat = ReturnType<typeof recvStatus>;
function RecvItem({ r, st, months, setup, single, initial }: { r: Recv; st: RStat; months: Record<string, MonthDoc>; setup: GastosSetup; single: boolean; initial: boolean }) {
  const [open, setOpen] = useState(single || initial || st.late > 0);
  const [mode, setMode] = useState<string | null>(null); // "get:k" | "edit"
  const [all, setAll] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mode) panel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [mode]);
  const rows = st.rows;
  const first = rows.findIndex((x) => x.status !== "recebida");
  const shown = all ? rows : rows.filter((x, i) => x.status === "atrasada" || (first >= 0 ? i >= first - 2 && i < first + 4 : i >= rows.length - 3));
  const toggle = (m: string) => setMode(mode === m ? null : m);
  const undo = async (row: RecvRow) => {
    if (row.via === "voce") {
      const x = (r.gets ?? []).find((y) => y.k === row.k);
      if (!x || !await ask(`Desfazer o recebimento da parcela ${row.k + 1}?`)) return;
      if (x.gid && x.gm && months[x.gm]) await saveMonth(x.gm, months[x.gm].items.filter((g) => g.id !== x.gid));
      await saveRecvs((setup.recvs ?? []).map((y) => (y.id === r.id ? { ...y, gets: (y.gets ?? []).filter((z) => z.k !== row.k) } : y)));
    } else if (row.via === "extrato" && row.g) {
      const g = row.g;
      if (!await ask(`"${g.desc}" (${brl(g.v)}) não é pagamento de ${r.name}?`)) return;
      const gm = monthOf(g.d);
      if (g.ref === r.id) await saveMonth(gm, (months[gm]?.items ?? []).map((x) => (x.id === g.id ? { ...x, ref: undefined, parc: undefined } : x)));
      await saveRecvs((setup.recvs ?? []).map((y) => (y.id === r.id ? { ...y, notIds: [...(y.notIds ?? []), g.id], keys: (y.keys ?? []).filter((k) => k !== descKey(g.desc)) } : y)));
    }
  };
  const remove = async () => {
    if (await ask(`Remover ${r.name}? (os lançamentos na conta continuam)`)) await saveRecvs((setup.recvs ?? []).filter((x) => x.id !== r.id));
  };
  return (
    <div className={`loan${open ? " open" : ""}`}>
      <button className="loan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="loan-caret" aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="loan-name"><b>{r.name}</b><small className="muted">{st.got} de {r.n} recebidas - falta {brl(st.leftV, 0)} - {r.kind === "emprestei" ? "empréstimo" : "venda/serviço"}</small></span>
        <span className="loan-badge small">
          {st.late > 0 ? <span className="warn">{st.late} {st.late > 1 ? "atrasadas" : "atrasada"}</span>
            : st.next ? <span className="muted">próxima {dm(st.next)} - {brl(r.parcela, 0)}</span> : <span className="pos">quitado</span>}
        </span>
      </button>
      {open && (
        <div className="loan-body">
          <div className="limit">
            <span className="limit-fill paid" style={{ width: `${(st.got / r.n) * 100}%` }} />
            <small className="muted">{st.got} de {r.n} parcelas recebidas - {st.left > 0 ? `última em ${monthLabel(st.end, true)}` : "quitado"} - parcela {brl(r.parcela)} dia {r.dueDay}
              {r.note ? ` - ${r.note}` : ""}</small>
          </div>
          <div className="row wrapline loan-actions">
            {st.nextK !== null && <button className={mode === `get:${st.nextK}` ? "primary" : "ghost small-btn"} onClick={() => toggle(`get:${st.nextK}`)}>Recebi a parcela {st.nextK + 1}</button>}
            <button className={mode === "edit" ? "primary" : "ghost small-btn"} onClick={() => toggle("edit")}>Alterar</button>
            <button className="ghost small-btn" onClick={remove}>Remover</button>
          </div>
          <div ref={panel} className="loan-panel">
            {mode?.startsWith("get:") && <GetForm key={mode} r={r} k={Number(mode.slice(4))} months={months} setup={setup} onDone={() => setMode(null)} />}
            {mode === "edit" && <RecvForm r={r} months={months} setup={setup} onDone={() => setMode(null)} />}
          </div>
          <div className="table-scroll">
            <table className="loan-rows">
              <thead><tr><th>Parcela</th><th>Valor</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.k} className={x.status === "atrasada" ? "late" : x.k === st.nextK ? "nextrow" : ""}>
                    <td><span className="cell">{x.k + 1}/{r.n}<small className="muted">dia {dm(x.due)}/{x.due.slice(2, 4)}</small></span></td>
                    <td data-label="Valor">{brl(x.v ?? r.parcela)}</td>
                    <td data-label="Situação"><span className={`sit sit-${SIT[x.status].cls}`}>{SIT[x.status].label}</span>
                      {x.via === "extrato" && <small className="muted"> pelo extrato{x.d ? ` em ${dm(x.d)}` : ""}</small>}
                      {x.via === "voce" && x.d && <small className="muted"> em {dm(x.d)}</small>}
                      {x.via === "antes" && <small className="muted"> antes do cadastro</small>}</td>
                    <td className="actions">
                      {x.status !== "recebida" && <button className="link" onClick={() => toggle(`get:${x.k}`)}>recebi</button>}
                      {x.via === "voce" && <button className="link" onClick={() => undo(x)}>desfazer</button>}
                      {x.via === "extrato" && <button className="link" title="Desliga este lançamento da parcela: ela volta para a receber" onClick={() => undo(x)}>alterar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length || all ? <button className="link small" onClick={() => setAll(!all)}>{all ? "mostrar menos" : `ver todas as ${r.n} parcelas`}</button> : null}
        </div>
      )}
    </div>
  );
}

// Recebi uma parcela: quanto, quando e em qual conta caiu - ou so marcar (ja vai aparecer no extrato)
function GetForm({ r, k, months, setup, onDone }: { r: Recv; k: number; months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void }) {
  const accounts = accountsOf(setup);
  const [v, setV] = useState(fmt(r.parcela));
  const [d, setD] = useState(todayBR());
  const [acc, setAcc] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.round(num(v) * 100) / 100;
    if (!(val > 0)) return;
    setBusy(true);
    await receive(r, k, val, d, acc || null, months, setup);
    onDone();
  };
  const due = recvDue(r, k);
  return (
    <form className="fin-form loan-pay" onSubmit={save}>
      <p className="small"><b>Parcela {k + 1}/{r.n}</b> <span className="muted">combinada para {dm(due)}/{due.slice(2, 4)}</span></p>
      <div className="row wrapline">
        <label>Quanto recebeu (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        <label>Quando<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label>Em qual conta caiu
          <select value={acc} onChange={(e) => setAcc(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="">não lançar entrada (já está no extrato / recebi em dinheiro)</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Recebi"}</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
      <p className="muted small">{acc ? `Lança a entrada nessa conta (${r.kind === "emprestei" ? "Devolução de empréstimo, não é renda" : "Renda extra"}) e marca a parcela.`
        : "Só marca a parcela como recebida; o saldo da conta não muda."}</p>
    </form>
  );
}

// Novo / alterar: quem deve, de onde veio a divida, parcelas
function RecvForm({ r, months, setup, onDone }: { r?: Recv; months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void }) {
  const accounts = accountsOf(setup);
  const cur = monthOf(todayBR());
  const [name, setName] = useState(r?.name ?? "");
  const [kind, setKind] = useState<Recv["kind"]>(r?.kind ?? "emprestei");
  const [parcela, setParcela] = useState(r ? fmt(r.parcela) : "");
  const [n, setN] = useState(String(r?.n ?? 10));
  const [first, setFirst] = useState(r?.first ?? addMonths(cur, 1));
  const [dueDay, setDueDay] = useState(String(r?.dueDay ?? 10));
  const [gotBefore, setGotBefore] = useState(String(r?.gotBefore ?? 0));
  const [note, setNote] = useState(r?.note ?? "");
  // so no cadastro de emprestimo: registrar a saida do dinheiro emprestado
  const [outAcc, setOutAcc] = useState("");
  const [outD, setOutD] = useState(todayBR());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // conta com a pessoa: saldo de hoje (quem deve a quem) e a data dele
  const [s0, setS0] = useState(r?.saldo0 !== undefined ? fmt(Math.abs(r.saldo0)) : "");
  const [s0dir, setS0dir] = useState<"ela" | "eu">(r?.saldo0 !== undefined && r.saldo0 < 0 ? "eu" : "ela");
  const [since, setSince] = useState(r?.since ?? todayBR());
  const total = num(parcela) * (Math.round(num(n)) || 0);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const nn = Math.round(num(n));
    if (!name.trim()) return setErr("Quem te deve?");
    if (kind === "conta") {
      setBusy(true); setErr("");
      const base: Recv = r ?? { id: newId(), name: "", kind, parcela: 0, n: 0, first: cur, dueDay: 1 };
      const nr: Recv = { ...base, name: name.trim(), kind, saldo0: (s0dir === "eu" ? -1 : 1) * Math.round(num(s0) * 100) / 100, since,
        ...(note.trim() ? { note: note.trim() } : {}) };
      if (!note.trim()) delete nr.note;
      try {
        const list = setup.recvs ?? [];
        await saveRecvs(list.some((x) => x.id === nr.id) ? list.map((x) => (x.id === nr.id ? nr : x)) : [...list, nr]);
        onDone();
      } catch { setBusy(false); setErr("Não salvou (sem conexão?). Tente de novo."); }
      return;
    }
    if (!(num(parcela) > 0) || !(nn > 0)) return setErr("Informe o valor da parcela e quantas parcelas.");
    setBusy(true); setErr("");
    const base: Recv = r ?? { id: newId(), name: "", kind, parcela: 0, n: 0, first, dueDay: 10 };
    const nr: Recv = { ...base, name: name.trim(), kind, parcela: Math.round(num(parcela) * 100) / 100, n: nn, first,
      dueDay: Math.max(1, Math.min(31, Math.round(num(dueDay)) || 10)), gotBefore: Math.max(0, Math.min(nn, Math.round(num(gotBefore)) || 0)),
      ...(note.trim() ? { note: note.trim() } : {}) };
    if (!note.trim()) delete nr.note;
    try {
      if (!r && kind === "emprestei" && outAcc) {
        const g: Gasto = { id: newId(), d: outD, desc: `Emprestei para ${nr.name}`, v: Math.round(total * 100) / 100, tipo: "neutro", io: "out", cat: RECV_OUT_CAT, src: "manual", ref: nr.id, acc: outAcc };
        const gm = monthOf(outD);
        await saveMonth(gm, [...(months[gm]?.items ?? []), g]);
      }
      const list = setup.recvs ?? [];
      await saveRecvs(list.some((x) => x.id === nr.id) ? list.map((x) => (x.id === nr.id ? nr : x)) : [...list, nr]);
      onDone();
    } catch {
      setBusy(false); setErr("Não salvou (sem conexão?). Tente de novo.");
    }
  };
  const months36 = Array.from({ length: 49 }, (_, i) => addMonths(cur, i - 24));
  return (
    <form className="fin-form" onSubmit={save}>
      <div className="kind-pick" role="radiogroup" aria-label="De onde veio">
        <button type="button" role="radio" aria-checked={kind === "emprestei"} className={kind === "emprestei" ? "pill on" : "pill"} onClick={() => setKind("emprestei")}>Emprestei dinheiro</button>
        <button type="button" role="radio" aria-checked={kind === "venda"} className={kind === "venda" ? "pill on" : "pill"} onClick={() => setKind("venda")}>Vendi / prestei serviço</button>
        <button type="button" role="radio" aria-checked={kind === "conta"} className={kind === "conta" ? "pill on" : "pill"} onClick={() => setKind("conta")}>Conta com a pessoa (saldo sobe e desce)</button>
      </div>
      <p className="muted small">{kind === "emprestei" ? "O dinheiro já era seu: emprestar não é gasto e receber de volta não é renda (fica azul nos lançamentos)."
        : kind === "venda" ? "Cada parcela recebida conta como renda do mês (Renda extra)."
        : "Sem parcelas fixas: sobe quando você compra ou paga algo por ela, desce quando ela te paga (Pix, dinheiro ou pagando uma conta sua, como o condomínio)."}</p>
      {kind === "conta" ? (
        <div className="row wrapline">
          <label className="grow">Nome da pessoa<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome como aparece no Pix (ex.: Maria Souza)" /></label>
          <label>Hoje
            <select value={s0dir} onChange={(e) => setS0dir(e.target.value as "ela" | "eu")}>
              <option value="ela">ela me deve</option><option value="eu">eu devo a ela</option>
            </select>
          </label>
          <label>Valor (R$)<input value={s0} inputMode="decimal" onChange={(e) => setS0(e.target.value)} placeholder="1.000,00" /></label>
          <label>Saldo em<input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <label className="grow">Observação (opcional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="muted small full">Movimentos depois dessa data mexem no saldo: o que você marcar como &quot;Emprestei dinheiro&quot; para ela (débito, Pix ou cartão),
            os Pix dela que chegarem (pelo nome) e as contas suas que ela pagar.</p>
        </div>
      ) : <>
      <div className="row wrapline">
        <label className="grow">Quem te deve<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome como aparece no Pix (ex.: Jania Moreno)" /></label>
        <label>Valor da parcela (R$)<input value={parcela} inputMode="decimal" onChange={(e) => setParcela(e.target.value)} placeholder="100,00" /></label>
        <label>Parcelas<input value={n} inputMode="numeric" onChange={(e) => setN(e.target.value)} style={{ width: 70 }} /></label>
        <label>Primeira em
          <select value={first} onChange={(e) => setFirst(e.target.value)}>
            {!months36.includes(first) && <option value={first}>{monthLabel(first)}</option>}
            {months36.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label>Dia<input value={dueDay} inputMode="numeric" onChange={(e) => setDueDay(e.target.value)} style={{ width: 60 }} /></label>
        <label>Já recebeu<input value={gotBefore} inputMode="numeric" onChange={(e) => setGotBefore(e.target.value)} style={{ width: 70 }} title="parcelas já pagas antes de cadastrar (as primeiras)" /></label>
        <label className="grow">Observação (opcional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: emprestei para a reforma" /></label>
      </div>
      </>}
      {!r && kind === "emprestei" && (
        <div className="row wrapline">
          <label>Saída do empréstimo ({brl(total)})
            <select value={outAcc} onChange={(e) => setOutAcc(e.target.value)}>
              <option value="">não lançar (já está no extrato / foi há tempo)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>saiu da {a.name}</option>)}
            </select>
          </label>
          {outAcc && <label>Quando<input type="date" value={outD} onChange={(e) => setOutD(e.target.value)} /></label>}
        </div>
      )}
      {kind !== "conta" && total > 0 && <p className="small muted">Total: {Math.round(num(n))}x de {brl(num(parcela))} = <b>{brl(total)}</b>, de {monthLabel(first)} a {monthLabel(addMonths(first, Math.max(0, Math.round(num(n)) - 1)))}.
        {!r && kind === "emprestei" && !outAcc ? " Se o Pix que você mandou já está no extrato, mude a categoria dele para \"Emprestei dinheiro\"." : ""}</p>}
      {err && <p className="error small">{err}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>{busy ? "Salvando..." : r ? "Salvar" : "Adicionar"}</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------- conta com a pessoa ----------
const KIND_LABEL: Record<LedgerEntry["kind"], string> = { inicio: "saldo inicial", ajuste: "ajuste", porela: "você pagou por ela", pagou: "ela te pagou", pagouconta: "ela pagou uma conta sua" };
const saldoTxt = (v: number) => (v > 0.004 ? `te deve ${brl(v)}` : v < -0.004 ? `você deve ${brl(-v)}` : "zerado");

function ContaItem({ r, months, setup, single, initial }: { r: Recv; months: Record<string, MonthDoc>; setup: GastosSetup; single: boolean; initial: boolean }) {
  const led = recvLedger(r, months);
  const saldo = led.length ? led[led.length - 1].bal : 0;
  const [open, setOpen] = useState(single || initial);
  const [mode, setMode] = useState<string | null>(null); // "conta" | "pagou" | "porela" | "ajuste" | "edit"
  const [all, setAll] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mode) panel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [mode]);
  const toggle = (m: string) => setMode(mode === m ? null : m);
  const rows = [...led].reverse();
  const shown = all ? rows : rows.slice(0, 12);
  const undo = async (e: LedgerEntry) => {
    if (e.kind === "ajuste") {
      if (!(await ask(`Desfazer o ajuste "${e.desc}" (${brl(e.v)})?`))) return;
      await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, adj: (x.adj ?? []).filter((a) => a.id !== e.id) } : x)));
      return;
    }
    const g = e.g;
    if (!g) return;
    const gm = monthOf(g.d);
    if (g.src === "manual" && (g.by === r.id || g.ref === r.id)) {
      // criado aqui (pagou uma conta, recebi, gastei por ela): apaga
      if (!(await ask(`Apagar "${g.desc}" (${brl(g.v)})?`))) return;
      await saveMonth(gm, (months[gm]?.items ?? []).filter((x) => x.id !== g.id));
      return;
    }
    // veio do extrato: desliga desta pessoa
    if (!(await ask(`Desfazer: "${g.desc}" (${brl(g.v)}) não é da conta com ${r.name}?`))) return;
    if (g.ref === r.id || g.by === r.id) await saveMonth(gm, (months[gm]?.items ?? []).map((x) => (x.id === g.id ? { ...x, ref: undefined, by: undefined } : x)));
    await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, notIds: [...(x.notIds ?? []), g.id], keys: (x.keys ?? []).filter((k) => k !== descKey(g.desc)) } : x)));
  };
  const remove = async () => {
    if (await ask(`Remover a conta com ${r.name}? (os lançamentos continuam)`)) await saveRecvs((setup.recvs ?? []).filter((x) => x.id !== r.id));
  };
  return (
    <div className={`loan${open ? " open" : ""}`}>
      <button className="loan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="loan-caret" aria-hidden>{open ? "\u25BE" : "\u25B8"}</span>
        <span className="loan-name"><b>{r.name}</b><small className="muted">conta com a pessoa - {led.length - 1} movimentos{r.note ? ` - ${r.note}` : ""}</small></span>
        <span className="loan-badge small"><b className={saldo > 0 ? "pos" : saldo < 0 ? "warn" : "muted"}>{saldoTxt(saldo)}</b></span>
      </button>
      {open && (
        <div className="loan-body">
          <div className="row wrapline loan-actions">
            <button className={mode === "conta" ? "primary" : "ghost small-btn"} onClick={() => toggle("conta")}>Ela pagou uma conta minha</button>
            <button className={mode === "pagou" ? "primary" : "ghost small-btn"} onClick={() => toggle("pagou")}>Ela me pagou</button>
            <button className={mode === "porela" ? "primary" : "ghost small-btn"} onClick={() => toggle("porela")}>Paguei algo por ela</button>
            <button className={mode === "ajuste" ? "primary" : "ghost small-btn"} onClick={() => toggle("ajuste")}>Ajuste</button>
            <button className={mode === "edit" ? "primary" : "ghost small-btn"} onClick={() => toggle("edit")}>Alterar</button>
            <button className="ghost small-btn" onClick={remove}>Remover</button>
          </div>
          <div ref={panel} className="loan-panel">
            {mode && mode !== "edit" && <MoveForm key={mode} mode={mode as MoveMode} r={r} months={months} setup={setup} onDone={() => setMode(null)} />}
            {mode === "edit" && <RecvForm r={r} months={months} setup={setup} onDone={() => setMode(null)} />}
          </div>
          <div className="table-scroll">
            <table className="loan-rows ledger">
              <thead><tr><th>Data</th><th>Movimento</th><th>Valor</th><th>Saldo</th><th /></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id + e.d}>
                    <td>{e.kind === "inicio" ? (r.since ? `${dm(r.since)}/${r.since.slice(2, 4)}` : "-") : `${dm(e.d)}/${e.d.slice(2, 4)}`}</td>
                    <td data-label="Movimento"><span className="cell">{e.desc}<small className="muted">{KIND_LABEL[e.kind]}{e.auto ? " (pelo nome no extrato)" : ""}{e.g?.card ? " - cartão" : ""}</small></span></td>
                    <td data-label="Valor" className={e.kind === "inicio" ? "" : e.v > 0 ? "v-out" : "pos"}>{e.kind === "inicio" ? brl(e.v) : `${e.v > 0 ? "+" : "-"}${brl(Math.abs(e.v))}`}</td>
                    <td data-label="Saldo"><b className={e.bal > 0 ? "" : e.bal < 0 ? "warn" : "muted"}>{saldoTxt(e.bal)}</b></td>
                    <td className="actions">{e.kind !== "inicio" && <button className="link" onClick={() => undo(e)}>{e.kind === "ajuste" || e.g?.src === "manual" ? "desfazer" : "não é dela"}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length || all ? <button className="link small" onClick={() => setAll(!all)}>{all ? "mostrar menos" : `ver todos (${rows.length})`}</button> : null}
          <p className="muted small">+ ela passa a te dever mais; - ela te pagou. Compra no cartão ou Pix que você fez por ela e já está no extrato/fatura:
            mude a categoria para &quot;Emprestei dinheiro&quot; e escolha {r.name}. O que ela paga de contas suas continua sendo seu gasto do mês,
            mas não sai da sua conta.</p>
        </div>
      )}
    </div>
  );
}

type MoveMode = "conta" | "pagou" | "porela" | "ajuste";
function MoveForm({ mode, r, months, setup, onDone }: { mode: MoveMode; r: Recv; months: Record<string, MonthDoc>; setup: GastosSetup; onDone: () => void }) {
  const accounts = accountsOf(setup);
  const cur = monthOf(todayBR());
  const fixos = setup.fixos.filter((f) => fixoActive(f, cur) && !f.entrada);
  const [fx, setFx] = useState(mode === "conta" ? (fixos.find((f) => /condom/i.test(f.desc))?.id ?? fixos[0]?.id ?? "") : "");
  const fixo = setup.fixos.find((f) => f.id === fx);
  const [v, setV] = useState(fixo ? fmt(fixoExpected(fixo, cur, months)) : "");
  const [d, setD] = useState(todayBR());
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState(mode === "conta" ? "Moradia" : "");
  const [where, setWhere] = useState(accounts[0] ? `acc:${accounts[0].id}` : ""); // pagou / porela: conta, cartao ou nenhum
  const [sign, setSign] = useState<"mais" | "menos">("mais");
  const [busy, setBusy] = useState(false);
  const pickFx = (id: string) => { setFx(id); const f = setup.fixos.find((x) => x.id === id); if (f) setV(fmt(fixoExpected(f, monthOf(d), months))); };
  const add = async (g: Gasto) => { const gm = monthOf(g.d); await saveMonth(gm, [...(months[gm]?.items ?? []), g]); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.round(num(v) * 100) / 100;
    if (!(val > 0)) return;
    setBusy(true);
    if (mode === "conta") {
      // conta sua paga por ela: seu gasto (marca o fixo como pago), sem sair da sua conta; abate o saldo dela
      const name = fixo ? fixo.desc : desc.trim() || "Conta";
      await add({ id: newId(), d, desc: `${name} (pago por ${r.name})`, v: val, tipo: "gasto", cat: fixo ? fixo.cat : cat || "Outros", src: "manual", by: r.id, ...(fixo ? { ref: fixo.id } : {}) });
    } else if (mode === "pagou") {
      if (where.startsWith("acc:")) await add({ id: newId(), d, desc: desc.trim() || `${r.name} me pagou`, v: val, tipo: "neutro", io: "in", cat: RECV_BACK_CAT, src: "manual", ref: r.id, acc: where.slice(4) });
      else await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, adj: [...(x.adj ?? []), { id: newId(), d, v: -val, desc: desc.trim() || "me pagou em dinheiro" }] } : x)));
    } else if (mode === "porela") {
      const base = { id: newId(), d, desc: desc.trim() || `Para ${r.name}`, v: val, tipo: "neutro" as const, io: "out" as const, cat: RECV_OUT_CAT, src: "manual" as const, ref: r.id };
      if (where.startsWith("acc:")) await add({ ...base, acc: where.slice(4) });
      else if (where.startsWith("card:")) await add({ ...base, card: where.slice(5) });
      else await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, adj: [...(x.adj ?? []), { id: newId(), d, v: val, desc: desc.trim() || "paguei por ela" }] } : x)));
    } else {
      await saveRecvs((setup.recvs ?? []).map((x) => (x.id === r.id ? { ...x, adj: [...(x.adj ?? []), { id: newId(), d, v: sign === "mais" ? val : -val, desc: desc.trim() || "ajuste" }] } : x)));
    }
    onDone();
  };
  return (
    <form className="fin-form loan-pay" onSubmit={save}>
      <div className="row wrapline">
        {mode === "conta" && (
          <label>Qual conta
            <select value={fx} onChange={(e) => pickFx(e.target.value)}>
              {fixos.map((f) => <option key={f.id} value={f.id}>{f.desc} (fixo)</option>)}
              <option value="">outra conta...</option>
            </select>
          </label>
        )}
        {mode === "conta" && !fx && <label>Categoria<CatSelect value={cat || "Moradia"} onChange={setCat} dir="out" /></label>}
        {mode === "ajuste" && (
          <label>Tipo
            <select value={sign} onChange={(e) => setSign(e.target.value as "mais" | "menos")}>
              <option value="mais">ela passa a dever mais</option><option value="menos">ela deve menos</option>
            </select>
          </label>
        )}
        {(mode !== "conta" || !fx) && <label className="grow">Descrição<input value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder={mode === "conta" ? "ex.: água, IPTU" : mode === "porela" ? "ex.: compra na Magalu" : mode === "pagou" ? "ex.: Pix" : "ex.: acerto"} /></label>}
        <label>Valor (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} /></label>
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        {mode === "pagou" && (
          <label>Onde caiu
            <select value={where} onChange={(e) => setWhere(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={`acc:${a.id}`}>na {a.name} (não vem no extrato)</option>)}
              <option value="">em dinheiro / já está no extrato</option>
            </select>
          </label>
        )}
        {mode === "porela" && (
          <label>Pago com
            <select value={where} onChange={(e) => setWhere(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={`acc:${a.id}`}>{a.name}</option>)}
              {setup.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>cartão {c.name}</option>)}
              <option value="">dinheiro / só registrar</option>
            </select>
          </label>
        )}
        <button className="primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
      <p className="muted small">
        {mode === "conta" && "Conta como seu gasto do mês (o fixo fica pago, \"pago por\" ela), não sai da sua conta e abate do que ela te deve."}
        {mode === "pagou" && "Abate do que ela te deve. Pix dela que vier no extrato é reconhecido sozinho pelo nome: só use isto para o que não vem no extrato."}
        {mode === "porela" && "Não é gasto seu: ela passa a te dever. Se já está no extrato ou na fatura, em vez disto mude a categoria do lançamento para \"Emprestei dinheiro\" e escolha a pessoa."}
        {mode === "ajuste" && "Para acertos que não passaram por conta nem cartão."}
      </p>
    </form>
  );
}

// Lancamento "Emprestei dinheiro" / "Devolucao de emprestimo": para quem foi / de quem veio (liga a conta com a pessoa)
export function RecvSelect({ g, m, months, setup }: { g: Gasto; m: string; months: Record<string, MonthDoc>; setup: GastosSetup }) {
  const list = (setup.recvs ?? []).filter((r) => r.kind !== "venda");
  const out = g.cat === RECV_OUT_CAT;
  const value = g.ref && list.some((r) => r.id === g.ref) ? g.ref : "";
  const set = async (id: string) => {
    let rid = id;
    if (id === "__new") {
      const name = await askText(out ? "Para quem foi? (nome como aparece no Pix)" : "De quem veio? (nome como aparece no Pix)");
      if (!name?.trim()) return;
      // conta nova comeca zerada no dia anterior a este lancamento
      const since = new Date(Date.parse(`${g.d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const nr: Recv = { id: newId(), name: name.trim(), kind: "conta", parcela: 0, n: 0, first: monthOf(g.d), dueDay: 1, saldo0: 0, since };
      await saveRecvs([...(setup.recvs ?? []), nr]);
      rid = nr.id;
    }
    await saveMonth(m, (months[m]?.items ?? []).map((x) => (x.id === g.id ? { ...x, ref: rid || undefined } : x)));
  };
  return (
    <select className={`cat-sel inv-sel${value ? "" : " unlinked"}`} value={value} onChange={(e) => set(e.target.value)} title={out ? "Para quem foi" : "De quem veio"}>
      <option value="">{out ? "para quem? (escolher)" : "de quem? (escolher)"}</option>
      {list.map((r) => <option key={r.id} value={r.id}>{out ? "-> " : "<- "}{r.name}</option>)}
      <option value="__new">+ nova pessoa</option>
    </select>
  );
}
