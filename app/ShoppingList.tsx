"use client";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { accountsOf, monthOf, newId, todayBR, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import { guardWrite, saveMonth } from "./gastosShared";
import { ask } from "./Dialog";
import Note from "./Note";

// Lista de compras do mercado: guardada em config/compras (no espaco de quem esta logado).
// freq = quantas vezes cada item ja entrou na lista (vira atalho de "itens frequentes")
type Item = { id: string; name: string; qty?: string; price?: number; done?: boolean };
type ListDoc = { items: Item[]; freq: Record<string, number> };

const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `R$ ${fmt(v)}`;
const num = (s: string) => {
  let t = s.replace(/[\sR$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return Number(t) || 0;
};
const key = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const cap = (s: string) => s.trim().charAt(0).toUpperCase() + s.trim().slice(1);
// "2 leite", "leite 2", "arroz 5kg" -> nome e quantidade
function parseItem(raw: string): { name: string; qty?: string } {
  const t = raw.trim().replace(/\s+/g, " ");
  const a = /^(\d+(?:[.,]\d+)?\s?(?:kg|g|l|ml|un|cx|pct|dz)?)\s+(.+)$/i.exec(t);
  if (a) return { name: cap(a[2]), qty: a[1] };
  const b = /^(.+?)\s+(\d+(?:[.,]\d+)?\s?(?:kg|g|l|ml|un|cx|pct|dz)?)$/i.exec(t);
  if (b) return { name: cap(b[1]), qty: b[2] };
  return { name: cap(t) };
}

export default function ShoppingList({ months, setup }: { months: Record<string, MonthDoc>; setup: GastosSetup }) {
  const [data, setData] = useState<ListDoc>({ items: [], freq: {} });
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [buy, setBuy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      return onSnapshot(doc(db(), P("config/compras")), (s) => {
        const d = s.data() as Partial<ListDoc> | undefined;
        setData({ items: d?.items ?? [], freq: d?.freq ?? {} });
        setLoaded(true);
      }, () => setLoaded(true));
    } catch { setLoaded(true); return undefined; }
  }, []);
  const save = async (next: ListDoc) => {
    guardWrite();
    setData(next); // na tela na hora; o banco confirma em seguida (sem internet, o Firebase guarda e envia quando voltar)
    try { await setDoc(doc(db(), P("config/compras")), JSON.parse(JSON.stringify(next))); }
    catch { setMsg("Não salvou no servidor ainda (sem conexão?). Confira quando a internet voltar."); }
  };

  const add = async (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const items = [...data.items];
    const freq = { ...data.freq };
    for (const p of parts) {
      const it = parseItem(p);
      const k = key(it.name);
      const dup = items.find((x) => key(x.name) === k && !x.done);
      if (dup) { if (it.qty) dup.qty = it.qty; continue; }
      items.push({ id: newId(), name: it.name, ...(it.qty ? { qty: it.qty } : {}) });
      freq[k] = (freq[k] ?? 0) + 1;
    }
    setText("");
    await save({ items, freq });
    input.current?.focus();
  };
  const update = (id: string, patch: Partial<Item>) => save({ ...data, items: data.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const remove = (id: string) => save({ ...data, items: data.items.filter((x) => x.id !== id) });

  const open = data.items.filter((x) => !x.done);
  const done = data.items.filter((x) => x.done);
  const est = (l: Item[]) => l.reduce((t, x) => t + (x.price ?? 0) * (Number((x.qty ?? "1").replace(",", ".").match(/^\d+(?:\.\d+)?/)?.[0]) || 1), 0);
  // itens frequentes que nao estao na lista agora (pelo nome mais usado)
  const freqChips = useMemo(() => {
    const inList = new Set(data.items.map((x) => key(x.name)));
    return Object.entries(data.freq).filter(([k]) => !inList.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => cap(k));
  }, [data.freq, data.items]);

  return (
    <>
      <section className="card shop">
        <div className="card-head"><h2>Lista de compras</h2>
          <span className="muted small">{open.length} a comprar{done.length ? ` - ${done.length} no carrinho` : ""}{est(data.items) > 0 ? ` - estimado ${brl(est(data.items))}` : ""}</span></div>
        <form className="shop-add" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: arroz, 2 leite, café, sabão 3" aria-label="Adicionar itens" />
          <button className="primary" type="submit" disabled={!text.trim()}>Adicionar</button>
        </form>
        {freqChips.length > 0 && (
          <div className="shop-freq small">
            <span className="muted">Frequentes:</span>
            {freqChips.map((n) => <button key={n} type="button" className="chip" onClick={() => add(n)}>+ {n}</button>)}
          </div>
        )}
        {!loaded ? <p className="muted small">Carregando...</p> : !data.items.length ? (
          <p className="muted small">Lista vazia. Escreva os itens acima (vários de uma vez, separados por vírgula).</p>
        ) : (
          <ul className="shop-list">
            {[...open, ...done].map((x) => (
              <li key={x.id} className={x.done ? "done" : ""}>
                <label className="shop-check">
                  <input type="checkbox" checked={!!x.done} onChange={(e) => update(x.id, { done: e.target.checked })} />
                  <span className="shop-name">{x.name}</span>
                </label>
                <input className="shop-qty" value={x.qty ?? ""} placeholder="qtd" aria-label={`Quantidade de ${x.name}`}
                  onChange={(e) => setData({ ...data, items: data.items.map((y) => (y.id === x.id ? { ...y, qty: e.target.value } : y)) })}
                  onBlur={(e) => update(x.id, { qty: e.target.value.trim() || undefined })} />
                <input className="shop-price" inputMode="decimal" defaultValue={x.price ? fmt(x.price) : ""} placeholder="R$" aria-label={`Preço de ${x.name}`}
                  onBlur={(e) => { const v = num(e.target.value); if (v !== (x.price ?? 0)) void update(x.id, { price: v > 0 ? v : undefined }); }} />
                <button type="button" className="link shop-x" aria-label={`Tirar ${x.name}`} onClick={() => remove(x.id)}>x</button>
              </li>
            ))}
          </ul>
        )}
        {data.items.length > 0 && (
          <div className="row wrapline shop-actions">
            {done.length > 0 && <button className="primary" onClick={() => setBuy(!buy)}>{buy ? "fechar" : "Terminei: lançar o gasto"}</button>}
            {done.length > 0 && <button className="ghost" onClick={() => save({ ...data, items: open })}>Tirar os marcados</button>}
            <button className="ghost" onClick={async () => { if (await ask("Apagar a lista inteira? (os itens frequentes continuam)")) await save({ ...data, items: [] }); }}>Apagar a lista</button>
          </div>
        )}
        {buy && <LaunchForm setup={setup} months={months} estimate={est(done)} onDone={async (m) => { setBuy(false); setMsg(m); await save({ ...data, items: open }); }} />}
        {msg && <p className="small pos">&#10003; {msg}</p>}
        <Note>Escreva vários itens de uma vez separados por vírgula; a quantidade pode vir antes ou depois (&quot;2 leite&quot;, &quot;sabão 3&quot;).
          No mercado, marque o que já pegou: vai para o fim da lista. O preço é opcional e serve para estimar o total. Ao terminar,
          &quot;lançar o gasto&quot; registra a compra em Lançamentos (categoria Mercado) e tira da lista o que foi comprado.
          Os itens que você mais usa aparecem em &quot;Frequentes&quot; para adicionar com um toque.</Note>
      </section>
    </>
  );
}

// Lanca a compra do mercado: valor, data e com o que pagou (conta ou cartao)
function LaunchForm({ setup, months, estimate, onDone }: { setup: GastosSetup; months: Record<string, MonthDoc>; estimate: number; onDone: (msg: string) => void }) {
  const accs = accountsOf(setup);
  const [v, setV] = useState(estimate > 0 ? fmt(estimate) : "");
  const [d, setD] = useState(todayBR());
  const [desc, setDesc] = useState("Mercado");
  const [src, setSrc] = useState(`acc:${accs[0].id}`);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = num(v);
    if (!(val > 0)) return;
    setBusy(true);
    try {
      const m = monthOf(d);
      const where = src.startsWith("card:") ? { card: src.slice(5) } : { acc: src.slice(4), io: "out" as const };
      await saveMonth(m, [...(months[m]?.items ?? []), { id: newId(), d, desc: desc.trim() || "Mercado", v: val, tipo: "gasto", cat: "Mercado", src: "manual", ...where }]);
      onDone(`Lançado: ${desc.trim() || "Mercado"}, ${brl(val)} em ${d.slice(8, 10)}/${d.slice(5, 7)}.`);
    } finally { setBusy(false); }
  };
  return (
    <form className="fin-form shop-launch" onSubmit={submit}>
      <div className="row wrapline">
        <label>Valor pago (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder="0,00" /></label>
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="grow">Descrição<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label>Pago com
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            {accs.map((a) => <option key={a.id} value={`acc:${a.id}`}>{a.name} (débito / Pix)</option>)}
            {setup.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>cartão {c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row"><button className="primary" type="submit" disabled={busy || !(num(v) > 0)}>{busy ? "Lançando..." : "Lançar gasto"}</button></div>
      {estimate > 0 && <p className="muted small">Estimado pelos preços dos itens marcados: {brl(estimate)}. Use o valor do cupom.</p>}
    </form>
  );
}
