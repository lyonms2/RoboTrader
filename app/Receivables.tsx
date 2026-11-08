"use client";
import { useEffect, useRef, useState } from "react";
import {
  RECV_BACK_CAT, RECV_OUT_CAT, RECV_SALE_CAT, accountsOf, addMonths, descKey, monthLabel, monthOf, newId, recvDue, recvStatus, todayBR,
  type Gasto, type GastosSetup, type MonthDoc, type Recv, type RecvRow,
} from "@/lib/gastos";
import { saveMonth, saveSetup } from "./GastosCard";
import { ask, askText, tell } from "./Dialog";

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number, d = 2) => `R$ ${fmt(v, d)}`;
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
          <div><span>Te devem</span><b className="pos">{brl(left)}</b><small className="muted">{list.filter((x) => x.st.left > 0).length} {list.length === 1 ? "pessoa/divida" : "pessoas/dividas"} - entra no patrimonio</small></div>
          {late > 0 && <div><span>Parcelas atrasadas</span><b className="warn">{late} - {brl(lateV)}</b><small className="muted">venceram sem pagamento</small></div>}
          <div><span>Proxima a receber</span><b>{nx ? brl(nx.r.parcela) : "-"}</b>
            <small className="muted">{nx ? `${nx.r.name} ${nx.st.nextK! + 1}/${nx.r.n} - ${nx.st.next! < today ? "venceu" : "dia"} ${dm(nx.st.next!)}/${nx.st.next!.slice(2, 4)}` : "nenhuma"}</small></div>
          <div><span>Ja recebido</span><b>{brl(got)}</b><small className="muted">soma das parcelas recebidas</small></div>
        </div>
        <p className="muted small">Pix com o nome da pessoa no extrato e reconhecido sozinho como parcela recebida. Recebeu e nao aparece? Use &quot;recebi&quot;.
          Dinheiro que voce emprestou volta como &quot;Devolucao de emprestimo&quot; (nao e renda); venda ou servico parcelado entra como renda.</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Quem te deve</h2>
          {!adding && <button className="ghost small-btn" onClick={() => setAdding(true)}>+ novo a receber</button>}</div>
        {adding && <div className="loan-form"><RecvForm months={months} setup={setup} onDone={() => setAdding(false)} /></div>}
        {list.map(({ r, st }) => <RecvItem key={r.id} r={r} st={st} months={months} setup={setup} single={list.length === 1} initial={openId === r.id} />)}
        {!list.length && !adding && <p className="muted small">Ninguem te deve nada cadastrado.</p>}
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
      if (!await ask(`"${g.desc}" (${brl(g.v)}) nao e pagamento de ${r.name}?`)) return;
      const gm = monthOf(g.d);
      if (g.ref === r.id) await saveMonth(gm, (months[gm]?.items ?? []).map((x) => (x.id === g.id ? { ...x, ref: undefined, parc: undefined } : x)));
      await saveRecvs((setup.recvs ?? []).map((y) => (y.id === r.id ? { ...y, notIds: [...(y.notIds ?? []), g.id], keys: (y.keys ?? []).filter((k) => k !== descKey(g.desc)) } : y)));
    }
  };
  const remove = async () => {
    if (await ask(`Remover ${r.name}? (os lancamentos na conta continuam)`)) await saveRecvs((setup.recvs ?? []).filter((x) => x.id !== r.id));
  };
  return (
    <div className={`loan${open ? " open" : ""}`}>
      <button className="loan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="loan-caret" aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="loan-name"><b>{r.name}</b><small className="muted">{st.got} de {r.n} recebidas - falta {brl(st.leftV, 0)} - {r.kind === "emprestei" ? "emprestimo" : "venda/servico"}</small></span>
        <span className="loan-badge small">
          {st.late > 0 ? <span className="warn">{st.late} {st.late > 1 ? "atrasadas" : "atrasada"}</span>
            : st.next ? <span className="muted">proxima {dm(st.next)} - {brl(r.parcela, 0)}</span> : <span className="pos">quitado</span>}
        </span>
      </button>
      {open && (
        <div className="loan-body">
          <div className="limit">
            <span className="limit-fill paid" style={{ width: `${(st.got / r.n) * 100}%` }} />
            <small className="muted">{st.got} de {r.n} parcelas recebidas - {st.left > 0 ? `ultima em ${monthLabel(st.end, true)}` : "quitado"} - parcela {brl(r.parcela)} dia {r.dueDay}
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
              <thead><tr><th>Parcela</th><th>Valor</th><th>Situacao</th><th /></tr></thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.k} className={x.status === "atrasada" ? "late" : x.k === st.nextK ? "nextrow" : ""}>
                    <td><span className="cell">{x.k + 1}/{r.n}<small className="muted">dia {dm(x.due)}/{x.due.slice(2, 4)}</small></span></td>
                    <td data-label="Valor">{brl(x.v ?? r.parcela)}</td>
                    <td data-label="Situacao"><span className={`sit sit-${SIT[x.status].cls}`}>{SIT[x.status].label}</span>
                      {x.via === "extrato" && <small className="muted"> pelo extrato{x.d ? ` em ${dm(x.d)}` : ""}</small>}
                      {x.via === "voce" && x.d && <small className="muted"> em {dm(x.d)}</small>}
                      {x.via === "antes" && <small className="muted"> antes do cadastro</small>}</td>
                    <td className="actions">
                      {x.status !== "recebida" && <button className="link" onClick={() => toggle(`get:${x.k}`)}>recebi</button>}
                      {x.via === "voce" && <button className="link" onClick={() => undo(x)}>desfazer</button>}
                      {x.via === "extrato" && <button className="link" onClick={() => undo(x)}>nao e este</button>}
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
            <option value="">nao lancar entrada (ja esta no extrato / recebi em dinheiro)</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Recebi"}</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
      <p className="muted small">{acc ? `Lanca a entrada nessa conta (${r.kind === "emprestei" ? "Devolucao de emprestimo, nao e renda" : "Renda extra"}) e marca a parcela.`
        : "So marca a parcela como recebida; o saldo da conta nao muda."}</p>
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
  const total = num(parcela) * (Math.round(num(n)) || 0);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const nn = Math.round(num(n));
    if (!name.trim()) return setErr("Quem te deve?");
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
      setBusy(false); setErr("Nao salvou (sem conexao?). Tente de novo.");
    }
  };
  const months36 = Array.from({ length: 49 }, (_, i) => addMonths(cur, i - 24));
  return (
    <form className="fin-form" onSubmit={save}>
      <div className="kind-pick" role="radiogroup" aria-label="De onde veio">
        <button type="button" role="radio" aria-checked={kind === "emprestei"} className={kind === "emprestei" ? "pill on" : "pill"} onClick={() => setKind("emprestei")}>Emprestei dinheiro</button>
        <button type="button" role="radio" aria-checked={kind === "venda"} className={kind === "venda" ? "pill on" : "pill"} onClick={() => setKind("venda")}>Vendi / prestei servico</button>
      </div>
      <p className="muted small">{kind === "emprestei" ? "O dinheiro ja era seu: emprestar nao e gasto e receber de volta nao e renda (fica azul nos lancamentos)."
        : "Cada parcela recebida conta como renda do mes (Renda extra)."}</p>
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
        <label>Ja recebeu<input value={gotBefore} inputMode="numeric" onChange={(e) => setGotBefore(e.target.value)} style={{ width: 70 }} title="parcelas ja pagas antes de cadastrar (as primeiras)" /></label>
        <label className="grow">Observacao (opcional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: emprestei para a reforma" /></label>
      </div>
      {!r && kind === "emprestei" && (
        <div className="row wrapline">
          <label>Saida do emprestimo ({brl(total)})
            <select value={outAcc} onChange={(e) => setOutAcc(e.target.value)}>
              <option value="">nao lancar (ja esta no extrato / foi ha tempo)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>saiu da {a.name}</option>)}
            </select>
          </label>
          {outAcc && <label>Quando<input type="date" value={outD} onChange={(e) => setOutD(e.target.value)} /></label>}
        </div>
      )}
      {total > 0 && <p className="small muted">Total: {Math.round(num(n))}x de {brl(num(parcela))} = <b>{brl(total)}</b>, de {monthLabel(first)} a {monthLabel(addMonths(first, Math.max(0, Math.round(num(n)) - 1)))}.
        {!r && kind === "emprestei" && !outAcc ? " Se o Pix que voce mandou ja esta no extrato, mude a categoria dele para \"Emprestei dinheiro\"." : ""}</p>}
      {err && <p className="error small">{err}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>{busy ? "Salvando..." : r ? "Salvar" : "Adicionar"}</button>
        <button className="ghost" type="button" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}
