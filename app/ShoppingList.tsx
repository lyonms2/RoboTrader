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
// prices = produtos salvos: historico de precos de cada produto (por nome), para preencher sozinho e comparar
type PriceRec = { v: number; d: string };
type Product = { name: string; hist: PriceRec[] };
type ListDoc = { items: Item[]; freq: Record<string, number>; prices: Record<string, Product> };

// Quantidade em numero: "3" -> 3; "1,37 Kg" -> 1,37; "500 g" / "500 ml" -> 0,5 (o preco e por kg ou litro); vazio -> 1
export function qtyNum(q?: string) {
  const m = /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|un|cx|pct|dz)?/i.exec((q ?? "").trim());
  if (!m) return 1;
  const n = Number(m[1].replace(",", ".")) || 1;
  const u = (m[2] ?? "").toLowerCase();
  return u === "g" || u === "ml" ? n / 1000 : n;
}
// Total da linha = quantidade x preco unitario (ou do kg)
export const lineTotal = (x: { qty?: string; price?: number }) => (x.price ?? 0) * qtyNum(x.qty);

// Novo preco x historico do produto (sem contar o registro de hoje): menor, barato, na media ou caro
export function verdict(prod: Product | undefined, v: number, today: string) {
  const prev = (prod?.hist ?? []).filter((h) => h.d !== today).slice(-10);
  if (!prev.length || !(v > 0)) return null;
  const vals = prev.map((h) => h.v);
  const avg = vals.reduce((t, x) => t + x, 0) / vals.length;
  const min = Math.min(...vals);
  const diff = v / avg - 1;
  const tag = v < min - 0.005 ? { cls: "good", t: "menor preço" } : diff <= -0.03 ? { cls: "good", t: "barato" }
    : diff >= 0.08 ? { cls: "bad", t: `caro (+${fmt(diff * 100, 0)}%)` } : { cls: "", t: "na média" };
  return { ...tag, avg, min, last: prev[prev.length - 1] };
}

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
  const [data, setData] = useState<ListDoc>({ items: [], freq: {}, prices: {} });
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [warn, setWarn] = useState("");
  const [buy, setBuy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      return onSnapshot(doc(db(), P("config/compras")), (s) => {
        const d = s.data() as Partial<ListDoc> | undefined;
        setData({ items: d?.items ?? [], freq: d?.freq ?? {}, prices: d?.prices ?? {} });
        setLoaded(true);
      }, () => setLoaded(true));
    } catch { setLoaded(true); return undefined; }
  }, []);
  const save = async (next: ListDoc) => {
    guardWrite();
    setData(next); // na tela na hora; o banco confirma em seguida (sem internet, o Firebase guarda e envia quando voltar)
    try { await setDoc(doc(db(), P("config/compras")), JSON.parse(JSON.stringify(next))); setWarn(""); }
    catch { setWarn("Não salvou no servidor ainda (sem conexão?). Confira quando a internet voltar."); }
  };

  const add = async (raw: string) => {
    // separa os itens pela virgula, mas nao a virgula decimal ("1,37 kg laranja" e um item so)
    const parts = raw.replace(/(\d),(\d)/g, "$1\u0000$2").split(/[,;\n]/).map((x) => x.replace(/\u0000/g, ",").trim()).filter(Boolean);
    if (!parts.length) return;
    const items = [...data.items];
    const freq = { ...data.freq };
    for (const p of parts) {
      const it = parseItem(p);
      const k = key(it.name);
      const dup = items.find((x) => key(x.name) === k && !x.done);
      if (dup) { if (it.qty) dup.qty = it.qty; continue; }
      const h = data.prices[k]?.hist ?? []; const last = h.length ? h[h.length - 1].v : undefined;
      items.push({ id: newId(), name: it.name, ...(it.qty ? { qty: it.qty } : {}), ...(last ? { price: last } : {}) });
      freq[k] = (freq[k] ?? 0) + 1;
    }
    setText("");
    await save({ ...data, items, freq });
    input.current?.focus();
  };
  const update = (id: string, patch: Partial<Item>) => save({ ...data, items: data.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const today = todayBR();
  // guarda o preco no produto (um registro por dia; ate 30 por produto)
  const withPrice = (prices: Record<string, Product>, name: string, v: number) => {
    const k = key(name);
    const hist = (prices[k]?.hist ?? []).filter((h) => h.d !== today);
    return { ...prices, [k]: { name: prices[k]?.name ?? cap(name), hist: [...hist, { v, d: today }].slice(-30) } };
  };
  const setPrice = (x: Item, v: number) => save({
    ...data, items: data.items.map((y) => (y.id === x.id ? { ...y, price: v > 0 ? v : undefined } : y)),
    prices: v > 0 ? withPrice(data.prices, x.name, v) : data.prices,
  });
  const remove = (id: string) => save({ ...data, items: data.items.filter((x) => x.id !== id) });

  const open = data.items.filter((x) => !x.done);
  const done = data.items.filter((x) => x.done);
  const est = (l: Item[]) => l.reduce((t, x) => t + lineTotal(x), 0);
  // itens frequentes que nao estao na lista agora (pelo nome mais usado)
  const freqChips = useMemo(() => {
    const inList = new Set(data.items.map((x) => key(x.name)));
    return Object.entries(data.freq).filter(([k]) => !inList.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => cap(k));
  }, [data.freq, data.items]);
  const products = Object.entries(data.prices).sort((a, b) => a[1].name.localeCompare(b[1].name));

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
            <li className="shop-head" aria-hidden="true"><span>Item</span><span>Kg/Qtd</span><span>Preço un.</span><span>Total</span><span /></li>
            {[...open, ...done].map((x) => (
              <li key={x.id} className={x.done ? "done" : ""}>
                <label className="shop-check">
                  <input type="checkbox" checked={!!x.done} onChange={(e) => update(x.id, { done: e.target.checked })} />
                  <span className="shop-name">{x.name}</span>
                </label>
                <input className="shop-qty" value={x.qty ?? ""} placeholder="kg/qtd" inputMode="decimal" aria-label={`Quantidade ou peso de ${x.name}`}
                  onChange={(e) => setData({ ...data, items: data.items.map((y) => (y.id === x.id ? { ...y, qty: e.target.value } : y)) })}
                  onBlur={(e) => update(x.id, { qty: e.target.value.trim() || undefined })} />
                <input key={`${x.id}-${x.price ?? ""}`} className="shop-price" inputMode="decimal" defaultValue={x.price ? fmt(x.price) : ""} placeholder="R$ un." aria-label={`Preço de ${x.name}`}
                  onBlur={(e) => { const v = num(e.target.value); if (v !== (x.price ?? 0)) void setPrice(x, v); }} />
                <span className="shop-tot">{x.price ? brl(lineTotal(x)) : "-"}</span>
                <button type="button" className="shop-x" aria-label={`Tirar ${x.name} da lista`} title="Tirar da lista" onClick={() => remove(x.id)}>&times;</button>
                {(() => {
                  const prod = data.prices[key(x.name)];
                  const vd = x.price ? verdict(prod, x.price, today) : null;
                  const prev = (prod?.hist ?? []).filter((h) => h.d !== today);
                  if (!vd && !prev.length) return null;
                  return (
                    <div className="shop-info">
                      {vd && <span className={`shop-tag ${vd.cls}`}>{vd.t}</span>}
                      {prev.length > 0 && <span className="muted">último {brl(prev[prev.length - 1].v)} ({prev[prev.length - 1].d.slice(8, 10)}/{prev[prev.length - 1].d.slice(5, 7)})
                        {prev.length > 1 ? ` - média ${brl(prev.reduce((t, h) => t + h.v, 0) / prev.length)} - menor ${brl(Math.min(...prev.map((h) => h.v)))}` : ""}</span>}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
        {est(data.items) > 0 && (
          <div className="shop-sum">
            {done.length > 0 && <div><span>No carrinho ({done.length})</span><b>{brl(est(done))}</b></div>}
            {open.length > 0 && est(open) > 0 && <div><span>Falta pegar ({open.length})</span><b>{brl(est(open))}</b></div>}
            <div className="total"><span>Total da lista</span><b>{brl(est(data.items))}</b></div>
          </div>
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
        {warn && <p className="small warn">{warn}</p>}
        <Products products={products} today={today}
          onSave={(name, v) => save({ ...data, prices: withPrice(data.prices, name, v) })}
          onRemove={(k) => save({ ...data, prices: Object.fromEntries(Object.entries(data.prices).filter(([x]) => x !== k)) })}
          onAdd={(name) => add(name)} />
        <Note>Escreva vários itens de uma vez separados por vírgula; a quantidade pode vir antes ou depois (&quot;2 leite&quot;, &quot;sabão 3&quot;).
          O preço que você digita fica salvo no produto: na próxima lista ele já vem preenchido e, quando muda, o site compara com
          os preços anteriores (menor preço, barato, na média ou caro). Kg/Qtd: quantas unidades ou o peso (1,37 kg; 500 g conta
          como 0,5 kg). Preço un.: o preço da unidade ou do quilo. Total = Kg/Qtd x Preço un.
          No mercado, marque o que já pegou: vai para o fim da lista. O preço é opcional e serve para estimar o total. Ao terminar,
          &quot;lançar o gasto&quot; registra a compra em Lançamentos (categoria Mercado) e tira da lista o que foi comprado.
          Os itens que você mais usa aparecem em &quot;Frequentes&quot; para adicionar com um toque.</Note>
      </section>
    </>
  );
}

// Produtos salvos: ultimo, menor e media de preco; salvar um produto com o preco (sem estar comprando)
function Products({ products, today, onSave, onRemove, onAdd }: {
  products: [string, Product][]; today: string; onSave: (name: string, v: number) => Promise<void>; onRemove: (k: string) => Promise<void>; onAdd: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [v, setV] = useState("");
  const [q, setQ] = useState("");
  const shown = products.filter(([, p]) => !q || key(p.name).includes(key(q)));
  const prev = name.trim() ? products.find(([k]) => k === key(name))?.[1] : undefined;
  const vd = prev && num(v) > 0 ? verdict(prev, num(v), today) : null;
  return (
    <details className="eq-more shop-prod">
      <summary>Produtos salvos ({products.length}): preços para comparar</summary>
      <form className="row wrapline" onSubmit={async (e) => { e.preventDefault(); if (!name.trim() || !(num(v) > 0)) return; await onSave(name, num(v)); setName(""); setV(""); }}>
        <label className="grow">Produto<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Café (o mesmo nome da lista)" list="shop-prod-names" /></label>
        <label>Preço (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder="0,00" /></label>
        <button className="primary" type="submit" disabled={!name.trim() || !(num(v) > 0)}>Salvar preço</button>
        <datalist id="shop-prod-names">{products.map(([k, p]) => <option key={k} value={p.name} />)}</datalist>
      </form>
      {vd && <p className="small"><span className={`shop-tag ${vd.cls}`}>{vd.t}</span> <span className="muted">média {brl(vd.avg)} - menor {brl(vd.min)}</span></p>}
      {products.length > 6 && <input className="shop-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto..." aria-label="Procurar produto" />}
      {shown.length ? (
        <div className="table-scroll">
          <table className="stack shop-table">
            <thead><tr><th>Produto</th><th>Último</th><th>Menor</th><th>Média</th><th /></tr></thead>
            <tbody>
              {shown.map(([k, p]) => {
                const vals = p.hist.map((h) => h.v);
                const last = p.hist[p.hist.length - 1];
                return (
                  <tr key={k}>
                    <td><b>{p.name}</b><div className="muted small">{p.hist.length} {p.hist.length > 1 ? "preços" : "preço"}</div></td>
                    <td data-label="Último">{brl(last.v)} <small className="muted">{last.d.slice(8, 10)}/{last.d.slice(5, 7)}</small></td>
                    <td data-label="Menor">{brl(Math.min(...vals))}</td>
                    <td data-label="Média">{brl(vals.reduce((t, x) => t + x, 0) / vals.length)}</td>
                    <td className="actions"><button className="link" onClick={() => onAdd(p.name)}>+ lista</button>
                      <button className="link" onClick={() => onRemove(k)} aria-label={`Apagar ${p.name}`}>apagar</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="muted small">{products.length ? "Nenhum produto com esse nome." : "Nenhum produto salvo ainda. Digite o preço de um item da lista, ou salve aqui."}</p>}
    </details>
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
