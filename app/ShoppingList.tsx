"use client";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { accountsOf, budgetSpent, monthOf, newId, todayBR, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import { guardWrite, saveMonth } from "./gastosShared";
import { ask, askText } from "./Dialog";
import Note from "./Note";

// Lista de compras do mercado: guardada em config/compras (no espaco de quem esta logado).
// freq = quantas vezes cada item ja entrou na lista (atalho "Frequentes")
// prices = produtos salvos: historico de precos (com o mercado), tamanho da embalagem e os dias em que foi comprado
// store/stores = mercado de hoje e os mercados ja usados
type Item = { id: string; name: string; qty?: string; price?: number; done?: boolean };
type PriceRec = { v: number; d: string; s?: string };
type Product = { name: string; hist: PriceRec[]; size?: number; unit?: "kg" | "l" | "un"; buys?: string[] };
type ListDoc = { items: Item[]; freq: Record<string, number>; prices: Record<string, Product>; store?: string; stores?: string[] };

const DAY = 86_400_000;
const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `R$\u00a0${fmt(v)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const num = (s: string) => {
  let t = s.replace(/[\sR$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return Number(t) || 0;
};
const key = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const cap = (s: string) => s.trim().charAt(0).toUpperCase() + s.trim().slice(1);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

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
// Tamanho da embalagem: "5 kg" -> 5 kg; "900 ml" -> 0,9 l; "12 un" / "12" -> 12 un
export function parseSize(s: string): { size: number; unit: "kg" | "l" | "un" } | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|un|unidades?)?$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!(n > 0)) return null;
  const u = (m[2] ?? "un").toLowerCase();
  return u === "g" ? { size: n / 1000, unit: "kg" } : u === "kg" ? { size: n, unit: "kg" } : u === "ml" ? { size: n / 1000, unit: "l" }
    : u === "l" ? { size: n, unit: "l" } : { size: n, unit: "un" };
}
const sizeLabel = (p: Product) => (p.size ? (p.unit === "kg" ? (p.size < 1 ? `${fmt(p.size * 1000, 0)} g` : `${fmt(p.size, p.size % 1 ? 2 : 0)} kg`)
  : p.unit === "l" ? (p.size < 1 ? `${fmt(p.size * 1000, 0)} ml` : `${fmt(p.size, p.size % 1 ? 2 : 0)} l`) : `${fmt(p.size, 0)} un`) : "");
// Preco por kg/litro/unidade (so com o tamanho da embalagem informado)
const perUnit = (p: Product, v: number) => (p.size ? v / p.size : null);
const perLabel = (p: Product) => (p.unit === "l" ? "/l" : p.unit === "un" ? "/un" : "/kg");

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
// Hora de estocar: item que voce compra sempre, no menor preco da sua historia (e pelo menos 5% abaixo da media)
export function stockUp(prod: Product | undefined, v: number, freq: number, today: string) {
  const vd = verdict(prod, v, today);
  const often = freq >= 3 || (prod?.buys?.length ?? 0) >= 2;
  return !!vd && often && v <= vd.min + 0.005 && v <= vd.avg * 0.95;
}
// De quantos em quantos dias voce compra o produto e quando seria a proxima (precisa de 2 compras ou mais)
export function cadence(prod: Product | undefined) {
  const b = [...new Set(prod?.buys ?? [])].sort();
  if (b.length < 2) return null;
  const gaps = b.slice(1).map((d, i) => days(b[i], d)).filter((g) => g > 0);
  if (!gaps.length) return null;
  const every = Math.round(gaps.reduce((t, g) => t + g, 0) / gaps.length);
  const last = b[b.length - 1];
  const next = new Date(Date.parse(`${last}T12:00:00Z`) + every * DAY).toISOString().slice(0, 10);
  return { every, last, next };
}
// Sua inflacao: variacao media do preco dos produtos que voce compra entre ~N meses atras e o preco mais recente
export function personalInflation(prices: Record<string, Product>, monthsBack: number, today: string) {
  const cut = new Date(Date.parse(`${today}T12:00:00Z`) - monthsBack * 30.4 * DAY).toISOString().slice(0, 10);
  const recent = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * DAY).toISOString().slice(0, 10);
  const ch: number[] = [];
  for (const p of Object.values(prices)) {
    const old = [...p.hist].reverse().find((h) => h.d <= cut);
    const now = p.hist[p.hist.length - 1];
    if (old && now && now.d >= recent && old.v > 0) ch.push(now.v / old.v - 1);
  }
  return ch.length ? { pct: ch.reduce((t, x) => t + x, 0) / ch.length, n: ch.length } : null;
}
// Grupos de variacoes do mesmo produto (marcas, tipos): o maior comeco de nome em comum com outro produto
// (ex.: "Creme Ricota Lelo" e "Creme Ricota President" -> "Creme Ricota"; "Laranja Pera" e "Laranja Umbigo" -> "Laranja")
export function productGroups(prices: Record<string, Product>) {
  const ks = Object.keys(prices);
  const words = Object.fromEntries(ks.map((k) => [k, k.split(/\s+/)]));
  const label: Record<string, string> = {};
  for (const k of ks) {
    let best = 0;
    for (const o of ks) {
      if (o === k) continue;
      let n = 0;
      while (n < words[k].length && n < words[o].length && words[k][n] === words[o][n]) n++;
      if (n === words[k].length && n === words[o].length) continue;
      best = Math.max(best, n);
    }
    // "de", "da"... sozinhos no fim nao contam
    while (best > 0 && ["de", "da", "do", "com", "sem", "e"].includes(words[k][best - 1])) best--;
    if (best > 0) label[k] = cap(prices[k].name.split(/\s+/).slice(0, best).join(" "));
  }
  return label;
}
// "2 leite", "leite 2", "arroz 5kg" -> nome e quantidade
function parseItem(raw: string): { name: string; qty?: string } {
  const t = raw.trim().replace(/\s+/g, " ");
  const a = /^(\d+(?:[.,]\d+)?\s?(?:kg|g|l|ml|un|cx|pct|dz)?)\s+(.+)$/i.exec(t);
  if (a) return { name: cap(a[2]), qty: a[1] };
  const b = /^(.+?)\s+(\d+(?:[.,]\d+)?\s?(?:kg|g|l|ml|un|cx|pct|dz)?)$/i.exec(t);
  if (b) return { name: cap(b[1]), qty: b[2] };
  return { name: cap(t) };
}
// Nota fiscal (NFC-e): le os itens do texto copiado da pagina de consulta (layout nacional: "(Codigo: ...) Qtde.: 1 UN: UN
// Vl. Unit.: 4,59 Vl. Total 4,59") ou do cupom impresso ("18 7891910000197 ACUCAR REFINADO 1kg 1 UN 4,59 4,59").
// Nada e enviado a outro lugar: a consulta na Sefaz voce faz no seu celular (ela pede verificacao contra robos).
export type NotaItem = { desc: string; qty: number; unit: string; unitPrice: number; total: number };
const brNum = (x: string) => Number(x.replace(/\./g, "").replace(",", ".")) || 0;
export function parseNota(text: string): { items: NotaItem[]; store?: string; date?: string; total?: number } {
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const items: NotaItem[] = [];
  // pagina de consulta (layout nacional)
  const web = /([^\n()]{3,}?)\s*\(\s*C[óo]digo:?\s*\d+\s*\)\s*Qtde\.?:?\s*([\d.,]+)\s*UN:?\s*([A-Za-z]+)\s*Vl\.?\s*Unit\.?:?\s*([\d.,]+)\s*Vl\.?\s*Total:?\s*([\d.,]+)/gi;
  for (const m of t.matchAll(web)) items.push({ desc: m[1].trim(), qty: brNum(m[2]), unit: m[3].toUpperCase(), unitPrice: brNum(m[4]), total: brNum(m[5]) });
  // cupom impresso: uma linha por item
  if (!items.length) {
    const line = /^\s*\d{1,3}\s+\d{3,14}\s+(.+?)\s+([\d.,]+)\s*(UN|UND|KG|LT|L|PC|PCT|CX|DZ|G|ML|FD)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;
    for (const l of t.split("\n")) {
      const m = line.exec(l);
      if (m) items.push({ desc: m[1].trim(), qty: brNum(m[2]), unit: m[3].toUpperCase(), unitPrice: brNum(m[4]), total: brNum(m[5]) });
    }
  }
  const lines = t.split("\n").map((x) => x.trim()).filter(Boolean);
  const ci = lines.findIndex((x) => /CNPJ/i.test(x));
  const store = ci > 0 ? lines[ci - 1].replace(/\s*CNPJ.*$/i, "").trim() : ci === 0 ? lines[0].replace(/\s*CNPJ.*$/i, "").trim() || undefined : undefined;
  const dm2 = /(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}/.exec(t);
  // total da nota ("Valor a pagar" ou "Valor total"; nunca o "Vl. Total" de um item)
  const tot = /Valor\s+a\s+pagar\s*R?\$?:?\s*([\d.]+,\d{2})/i.exec(t) ?? /Valor\s+total\s*R?\$?:?\s*([\d.]+,\d{2})/i.exec(t);
  return { items, ...(store ? { store } : {}), ...(dm2 ? { date: `${dm2[3]}-${dm2[2]}-${dm2[1]}` } : {}), ...(tot ? { total: brNum(tot[1]) } : {}) };
}
// "ACUCAR REFINADO UNIAO 1KG" -> "Acucar refinado uniao 1kg" (o nome do produto salvo pode ser escolhido na tela)
const nice = (s: string) => cap(s.toLowerCase());
// Produto salvo mais parecido com o item da nota: mesma primeira palavra (sem acento), o que tiver mais palavras em comum
export function matchProduct(desc: string, prices: Record<string, Product>) {
  const w = key(desc).split(/\s+/);
  let best: string | null = null, score = 0;
  for (const k of Object.keys(prices)) {
    const kw = k.split(/\s+/);
    if (kw[0] !== w[0]) continue;
    const sc = kw.filter((x) => w.includes(x)).length;
    if (sc > score) { best = k; score = sc; }
  }
  return best;
}

// Mini grafico do preco ao longo do tempo
function Spark({ hist }: { hist: PriceRec[] }) {
  if (hist.length < 2) return <span className="muted small">-</span>;
  const vals = hist.map((h) => h.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const W = 84, H = 22;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (W - 4) + 2},${H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6)}`).join(" ");
  const up = vals[vals.length - 1] > vals[0];
  return (
    <svg className={`spark ${up ? "up" : "down"}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
      aria-label={`de ${brl(vals[0])} para ${brl(vals[vals.length - 1])}`}>
      <title>{`${dm(hist[0].d)} ${brl(vals[0])} -> ${dm(hist[hist.length - 1].d)} ${brl(vals[vals.length - 1])} (menor ${brl(lo)}, maior ${brl(hi)})`}</title>
      <polyline points={pts} />
    </svg>
  );
}

export default function ShoppingList({ months, setup, ipca12m }: { months: Record<string, MonthDoc>; setup: GastosSetup; ipca12m?: number | null }) {
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
        setData({ items: d?.items ?? [], freq: d?.freq ?? {}, prices: d?.prices ?? {}, store: d?.store, stores: d?.stores ?? [] });
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
  const today = todayBR();
  const lastPrice = (k: string) => { const h = data.prices[k]?.hist ?? []; return h.length ? h[h.length - 1].v : undefined; };

  const add = async (raw: string) => {
    // separa os itens pela virgula, mas nao a virgula decimal ("1,37 kg laranja" e um item so)
    const parts = raw.replace(/(\d),(\d)/g, "$1\u0000$2").split(/[,;\n]/).map((x) => x.replace(/\u0000/g, ",").trim()).filter(Boolean);
    if (!parts.length) return;
    const items = [...data.items];
    const freq = { ...data.freq };
    const already: string[] = [];
    for (const p of parts) {
      const it = parseItem(p);
      const k = key(it.name);
      // nao repete: ja esta na lista (ou no carrinho) -> so atualiza a quantidade
      const dup = items.find((x) => key(x.name) === k);
      if (dup) { if (it.qty) dup.qty = it.qty; already.push(dup.name); continue; }
      const last = lastPrice(k);
      items.push({ id: newId(), name: it.name, ...(it.qty ? { qty: it.qty } : {}), ...(last ? { price: last } : {}) });
      freq[k] = (freq[k] ?? 0) + 1;
    }
    setText("");
    if (already.length) setMsg(`Já estava na lista: ${already.join(", ")}.`);
    await save({ ...data, items, freq });
    input.current?.focus();
  };
  const update = (id: string, patch: Partial<Item>) => save({ ...data, items: data.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  // guarda o preco no produto (um registro por dia e mercado; ate 40 por produto)
  const withPrice = (prices: Record<string, Product>, name: string, v: number) => {
    const k = key(name);
    const hist = (prices[k]?.hist ?? []).filter((h) => !(h.d === today && (h.s ?? "") === (data.store ?? "")));
    return { ...prices, [k]: { ...(prices[k] ?? {}), name: prices[k]?.name ?? cap(name), hist: [...hist, { v, d: today, ...(data.store ? { s: data.store } : {}) }].slice(-40) } };
  };
  const saveNota = async (rows: { name: string; price: number }[], date: string, store: string | undefined, buyDay: boolean) => {
    const prices = { ...data.prices };
    for (const r of rows) {
      const k = key(r.name);
      const p = prices[k] ?? { name: cap(r.name), hist: [] };
      const hist = p.hist.filter((h) => !(h.d === date && (h.s ?? "") === (store ?? "")));
      prices[k] = { ...p, hist: [...hist, { v: r.price, d: date, ...(store ? { s: store } : {}) }].sort((a, b) => a.d.localeCompare(b.d)).slice(-40),
        ...(buyDay ? { buys: [...new Set([...(p.buys ?? []), date])].sort().slice(-12) } : {}) };
    }
    const stores = store ? [...new Set([...(data.stores ?? []), store])] : data.stores;
    await save({ ...data, prices, stores });
  };
  const setPrice = (x: Item, v: number) => save({
    ...data, items: data.items.map((y) => (y.id === x.id ? { ...y, price: v > 0 ? v : undefined } : y)),
    prices: v > 0 ? withPrice(data.prices, x.name, v) : data.prices,
  });
  const remove = (id: string) => save({ ...data, items: data.items.filter((x) => x.id !== id) });
  // compra terminada: o dia fica guardado em cada produto comprado (para saber de quanto em quanto tempo voce compra)
  const finish = (bought: Item[]) => {
    const prices = { ...data.prices };
    for (const x of bought) {
      const k = key(x.name);
      const p = prices[k] ?? { name: x.name, hist: [] };
      prices[k] = { ...p, buys: [...new Set([...(p.buys ?? []), today])].sort().slice(-12) };
    }
    return save({ ...data, items: data.items.filter((x) => !x.done), prices });
  };
  const setStore = async (v: string) => {
    if (v === "__new") {
      const raw = await askText("Nome do mercado (ex.: Fort, Bistek, Atacadão):", "");
      const name = raw?.trim();
      if (!name) return;
      const stores = [...new Set([...(data.stores ?? []), cap(name)])];
      return save({ ...data, store: cap(name), stores });
    }
    return save({ ...data, store: v || undefined });
  };

  const open = data.items.filter((x) => !x.done);
  const done = data.items.filter((x) => x.done);
  const est = (l: Item[]) => l.reduce((t, x) => t + lineTotal(x), 0);
  const inList = useMemo(() => new Set(data.items.map((x) => key(x.name))), [data.items]);
  // itens frequentes que nao estao na lista agora (pelo nome mais usado)
  const freqChips = useMemo(() => Object.entries(data.freq).filter(([k]) => !inList.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => data.prices[k]?.name ?? cap(k)),
    [data.freq, data.prices, inList]);
  // lista sugerida: o que costuma acabar ate daqui a 2 dias
  const dueSoon = useMemo(() => Object.entries(data.prices).map(([k, p]) => ({ k, p, c: cadence(p) }))
    .filter((x) => x.c && !inList.has(x.k) && days(today, x.c.next) <= 2).sort((a, b) => a.c!.next.localeCompare(b.c!.next)), [data.prices, inList, today]);
  // repetidos que ja estavam na lista (antes desta versao)
  const dupKeys = useMemo(() => { const c: Record<string, number> = {}; for (const x of data.items) c[key(x.name)] = (c[key(x.name)] ?? 0) + 1; return new Set(Object.keys(c).filter((k) => c[k] > 1)); }, [data.items]);
  const products = Object.entries(data.prices).sort((a, b) => a[1].name.localeCompare(b[1].name));
  // esta lista em cada mercado (com o ultimo preco de cada item naquele mercado)
  const byStore = (data.stores ?? []).map((s) => {
    let tot = 0, n = 0;
    for (const x of data.items) {
      const h = [...(data.prices[key(x.name)]?.hist ?? [])].reverse().find((r) => r.s === s);
      if (h) { tot += h.v * qtyNum(x.qty); n++; }
    }
    return { s, tot, n };
  }).filter((x) => x.n > 0);
  // previsao do mercado no mes: o que ja saiu em Mercado + esta lista x orcamento
  const m = monthOf(today);
  const spentMercado = budgetSpent(months, setup, m).Mercado ?? 0;
  const budget = setup.budgets?.Mercado ?? 0;
  const infl = [3, 6, 12].map((n) => ({ n, r: personalInflation(data.prices, n, today) })).filter((x) => x.r);

  return (
    <>
      <section className="card shop">
        <div className="card-head"><h2>Lista de compras</h2>
          <span className="muted small">{open.length} a comprar{done.length ? ` - ${done.length} no carrinho` : ""}{est(data.items) > 0 ? ` - estimado ${brl(est(data.items))}` : ""}</span></div>
        <div className="shop-store small">
          <span className="muted">Mercado de hoje:</span>
          <select value={data.store ?? ""} onChange={(e) => void setStore(e.target.value)} aria-label="Mercado de hoje">
            <option value="">não informado</option>
            {(data.stores ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__new">+ novo mercado</option>
          </select>
        </div>
        <form className="shop-add" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: arroz, 2 leite, café, sabão 3" aria-label="Adicionar itens" />
          <button className="primary" type="submit" disabled={!text.trim()}>Adicionar</button>
        </form>
        {dueSoon.length > 0 && (
          <div className="shop-due small">
            <span><b>Está na hora de comprar:</b></span>
            {dueSoon.slice(0, 10).map(({ k, p, c }) => (
              <button key={k} type="button" className="chip" title={`Você compra a cada ~${c!.every} dias; última vez ${dm(c!.last)}`} onClick={() => add(p.name)}>
                + {p.name} <span className="muted">~{c!.every}d</span></button>
            ))}
            {dueSoon.length > 1 && <button type="button" className="link" onClick={() => add(dueSoon.map((x) => x.p.name).join(", "))}>adicionar todos</button>}
          </div>
        )}
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
            {[...open, ...done].map((x) => {
              const k = key(x.name);
              const prod = data.prices[k];
              return (
                <li key={x.id} className={x.done ? "done" : ""}>
                  <label className="shop-check">
                    <input type="checkbox" checked={!!x.done} onChange={(e) => update(x.id, { done: e.target.checked })} />
                    <span className="shop-name">{x.name}{dupKeys.has(k) && <span className="shop-tag bad">repetido</span>}</span>
                  </label>
                  <input className="shop-qty" value={x.qty ?? ""} placeholder="kg/qtd" inputMode="decimal" aria-label={`Quantidade ou peso de ${x.name}`}
                    onChange={(e) => setData({ ...data, items: data.items.map((y) => (y.id === x.id ? { ...y, qty: e.target.value } : y)) })}
                    onBlur={(e) => update(x.id, { qty: e.target.value.trim() || undefined })} />
                  <input key={`${x.id}-${x.price ?? ""}`} className="shop-price" inputMode="decimal" defaultValue={x.price ? fmt(x.price) : ""} placeholder="R$ un." aria-label={`Preço de ${x.name}`}
                    onBlur={(e) => { const v = num(e.target.value); if (v !== (x.price ?? 0)) void setPrice(x, v); }} />
                  <span className="shop-tot">{x.price ? brl(lineTotal(x)) : "-"}</span>
                  <button type="button" className="shop-x" aria-label={`Tirar ${x.name} da lista`} title="Tirar da lista" onClick={() => remove(x.id)}>&times;</button>
                  {(() => {
                    const vd = x.price ? verdict(prod, x.price, today) : null;
                    const prev = (prod?.hist ?? []).filter((h) => h.d !== today);
                    const pu = prod && x.price ? perUnit(prod, x.price) : null;
                    const stock = x.price ? stockUp(prod, x.price, data.freq[k] ?? 0, today) : false;
                    if (!vd && !prev.length && !pu) return null;
                    return (
                      <div className="shop-info">
                        {stock && <span className="shop-tag good">bom para estocar</span>}
                        {vd && !stock && <span className={`shop-tag ${vd.cls}`}>{vd.t}</span>}
                        {pu !== null && <span>{brl(pu)}{perLabel(prod!)}</span>}
                        {prev.length > 0 && <span className="muted">último {brl(prev[prev.length - 1].v)} ({dm(prev[prev.length - 1].d)}{prev[prev.length - 1].s ? `, ${prev[prev.length - 1].s}` : ""})
                          {prev.length > 1 ? ` - média ${brl(prev.reduce((t, h) => t + h.v, 0) / prev.length)} - menor ${brl(Math.min(...prev.map((h) => h.v)))}` : ""}</span>}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
        {est(data.items) > 0 && (
          <div className="shop-sum">
            {done.length > 0 && <div><span>No carrinho ({done.length})</span><b>{brl(est(done))}</b></div>}
            {open.length > 0 && est(open) > 0 && <div><span>Falta pegar ({open.length})</span><b>{brl(est(open))}</b></div>}
            <div className="total"><span>Total da lista</span><b>{brl(est(data.items))}</b></div>
            {byStore.length > 1 && (
              <div className="shop-stores"><span>Esta lista em cada mercado</span>
                <span>{byStore.sort((a, b) => a.tot - b.tot).map((x, i) => <span key={x.s} className={i === 0 ? "pos" : ""}>{x.s} {brl(x.tot)} <small className="muted">({x.n}/{data.items.length})</small></span>)}</span></div>
            )}
            <div className="shop-month">
              <span>Mercado no mês</span>
              <span>já saiu {brl(spentMercado)} + esta lista {brl(est(data.items))} = <b className={budget && spentMercado + est(data.items) > budget ? "neg" : ""}>{brl(spentMercado + est(data.items))}</b>
                {budget > 0 ? <small className={spentMercado + est(data.items) > budget ? "neg" : "muted"}> de {brl(budget)} do orçamento ({fmt(((spentMercado + est(data.items)) / budget) * 100, 0)}%)</small>
                  : <small className="muted"> (sem orçamento de Mercado)</small>}</span>
            </div>
          </div>
        )}
        {data.items.length > 0 && (
          <div className="row wrapline shop-actions">
            {done.length > 0 && <button className="primary" onClick={() => setBuy(!buy)}>{buy ? "fechar" : "Terminei: lançar o gasto"}</button>}
            {done.length > 0 && <button className="ghost" onClick={() => finish(done)}>Tirar os marcados</button>}
            <button className="ghost" onClick={async () => { if (await ask("Apagar a lista inteira? (os itens frequentes e os preços salvos continuam)")) await save({ ...data, items: [] }); }}>Apagar a lista</button>
          </div>
        )}
        {buy && <LaunchForm setup={setup} months={months} estimate={est(done)} store={data.store} onDone={async (mm) => { setBuy(false); setMsg(mm); await finish(done); }} />}
        {msg && <p className="small pos">&#10003; {msg}</p>}
        {warn && <p className="small warn">{warn}</p>}
        {infl.length > 0 && (
          <p className="shop-infl small"><b>Sua inflação no mercado:</b>
            {infl.map(({ n, r }) => <span key={n} className={r!.pct > 0 ? "neg" : "pos"}>{n} meses {r!.pct >= 0 ? "+" : ""}{fmt(r!.pct * 100, 1)}% <small className="muted">({r!.n} produtos)</small></span>)}
            {ipca12m != null && <span className="muted">IPCA 12 meses {fmt(ipca12m * 100, 1)}%</span>}
          </p>
        )}
        <NotaImport prices={data.prices} stores={data.stores ?? []} setup={setup} months={months}
          onSave={(rows, date, store) => saveNota(rows, date, store, true)} />
        <Products products={products} groups={productGroups(data.prices)} today={today} freq={data.freq}
          onSave={(name, v) => save({ ...data, prices: withPrice(data.prices, name, v) })}
          onSize={(k, s) => save({ ...data, prices: { ...data.prices, [k]: { ...data.prices[k], ...(s ? s : { size: undefined, unit: undefined }) } } })}
          onRemove={(k) => save({ ...data, prices: Object.fromEntries(Object.entries(data.prices).filter(([x]) => x !== k)) })}
          onAdd={(name) => add(name)} />
        <Note>Escreva vários itens de uma vez separados por vírgula; a quantidade pode vir antes ou depois (&quot;2 leite&quot;, &quot;sabão 3&quot;).
          Kg/Qtd: quantas unidades ou o peso (1,37 kg; 500 g conta como 0,5 kg). Preço un.: o preço da unidade ou do quilo. Total = Kg/Qtd x Preço un.
          O preço que você digita fica salvo no produto, com o mercado de hoje (escolha no topo da lista): na próxima lista ele já vem preenchido e o site compara com
          os anteriores (menor preço, barato, na média, caro; &quot;bom para estocar&quot; quando um item que você compra sempre está no menor preço).
          Com o tamanho da embalagem (em Produtos salvos) aparece o preço por kg/litro, para comparar pacotes diferentes.
          Ao terminar a compra (&quot;lançar o gasto&quot; ou &quot;tirar os marcados&quot;), o site guarda o dia: depois de 2 compras ele sabe de quanto em
          quanto tempo você compra cada coisa e mostra &quot;Está na hora de comprar&quot;. A inflação compara o preço de hoje com o de 3, 6 e 12 meses atrás.</Note>
      </section>
    </>
  );
}

// Produtos salvos: tamanho, ultimo preco, preco por kg, menor, media, mais barato em qual mercado, grafico; agrupados por variacao
function Products({ products, groups, today, freq, onSave, onSize, onRemove, onAdd }: {
  products: [string, Product][]; groups: Record<string, string>; today: string; freq: Record<string, number>;
  onSave: (name: string, v: number) => Promise<void>; onSize: (k: string, s: { size: number; unit: "kg" | "l" | "un" } | null) => Promise<void>;
  onRemove: (k: string) => Promise<void>; onAdd: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [v, setV] = useState("");
  const [q, setQ] = useState("");
  const shown = products.filter(([, p]) => !q || key(p.name).includes(key(q)));
  const prev = name.trim() ? products.find(([k]) => k === key(name))?.[1] : undefined;
  const vd = prev && num(v) > 0 ? verdict(prev, num(v), today) : null;
  // ordem: por grupo (variacoes juntas) e nome
  const rows = [...shown].sort((a, b) => (groups[a[0]] ?? a[1].name).localeCompare(groups[b[0]] ?? b[1].name) || a[1].name.localeCompare(b[1].name));
  // em cada grupo, o que sai mais barato (por kg/l/un quando todos tem tamanho; senao pelo ultimo preco)
  const cheapest: Record<string, string> = {};
  for (const g of new Set(Object.values(groups))) {
    const mem = products.filter(([k, p]) => groups[k] === g && p.hist.length);
    if (mem.length < 2) continue;
    const allSized = mem.every(([, p]) => p.size);
    const val = ([, p]: [string, Product]) => { const l = p.hist[p.hist.length - 1].v; return allSized ? l / p.size! : l; };
    cheapest[g] = [...mem].sort((a, b) => val(a) - val(b))[0][0];
  }
  const editSize = async (k: string, p: Product) => {
    const raw = await askText(`Tamanho da embalagem de "${p.name}" (ex.: 5 kg, 500 g, 900 ml, 12 un). Vazio tira o tamanho:`, sizeLabel(p));
    if (raw === null) return;
    if (!raw.trim()) return onSize(k, null);
    const s = parseSize(raw);
    if (s) await onSize(k, s);
  };
  let lastGroup = "";
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
      {rows.length ? (
        <div className="table-scroll">
          <Note>Variações do mesmo produto (marcas, tipos) ficam juntas, com a mais barata marcada: por kg/litro/unidade quando todas têm o
            tamanho informado (&quot;+ tamanho&quot;), senão pelo último preço. &quot;Mais barato em&quot;: o último preço em cada mercado, o menor primeiro.
            &quot;Preço no tempo&quot;: vermelho se subiu, verde se caiu. &quot;Bom para estocar&quot;: item que você compra sempre, no menor preço da sua história.</Note>
          <table className="stack shop-table">
            <thead><tr><th>Produto</th><th>Último</th><th>Por kg/l/un</th><th>Menor / média</th><th>Mais barato em</th><th>Preço no tempo</th><th /></tr></thead>
            <tbody>
              {rows.map(([k, p]) => {
                const g = groups[k];
                const head = g && g !== lastGroup && Object.values(groups).filter((x) => x === g).length > 1;
                if (g) lastGroup = g;
                const vals = p.hist.map((h) => h.v);
                const last = p.hist[p.hist.length - 1];
                // mais barato por mercado: o ultimo preco em cada mercado
                const st: Record<string, number> = {};
                for (const h of p.hist) if (h.s) st[h.s] = h.v;
                const best = Object.entries(st).sort((a, b) => a[1] - b[1])[0];
                const c = cadence(p);
                const stock = last ? stockUp(p, last.v, freq[k] ?? 0, today) : false;
                return [
                  head ? <tr key={`g-${g}`} className="grp-row"><td colSpan={7}><b>{g}</b> <span className="muted small">variações</span></td></tr> : null,
                  <tr key={k}>
                    <td><b>{p.name}</b> {cheapest[g ?? ""] === k && <span className="shop-tag good">mais barata</span>} {stock && <span className="shop-tag good">bom para estocar</span>}
                      <div className="muted small">{p.size ? sizeLabel(p) : <button className="link" onClick={() => editSize(k, p)}>+ tamanho</button>}
                        {p.size && <button className="link" onClick={() => editSize(k, p)}>alterar</button>}
                        {c ? ` - compra a cada ~${c.every} dias` : ""}</div></td>
                    <td data-label="Último">{last ? <>{brl(last.v)} <small className="muted">{dm(last.d)}</small></> : "-"}</td>
                    <td data-label="Por kg/l/un">{last && p.size ? `${brl(last.v / p.size)}${perLabel(p)}` : "-"}</td>
                    <td data-label="Menor / média">{vals.length ? <span className="cell">{brl(Math.min(...vals))}<small className="muted">média {brl(vals.reduce((t, x) => t + x, 0) / vals.length)}</small></span> : "-"}</td>
                    <td data-label="Mais barato em">{best ? <span className="cell">{best[0]}<small className="muted">{brl(best[1])}</small></span> : <span className="muted">-</span>}</td>
                    <td data-label="Preço no tempo"><Spark hist={p.hist} /></td>
                    <td className="actions"><button className="link" onClick={() => onAdd(p.name)}>+ lista</button>
                      <button className="link" onClick={() => onRemove(k)} aria-label={`Apagar ${p.name}`}>apagar</button></td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="muted small">{products.length ? "Nenhum produto com esse nome." : "Nenhum produto salvo ainda. Digite o preço de um item da lista, ou salve aqui."}</p>}
    </details>
  );
}

// Importar a nota fiscal: colar o texto da pagina da nota (aberta pelo QR code no celular), conferir e salvar os precos
function NotaImport({ prices, stores, setup, months, onSave }: {
  prices: Record<string, Product>; stores: string[]; setup: GastosSetup; months: Record<string, MonthDoc>;
  onSave: (rows: { name: string; price: number }[], date: string, store: string | undefined) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<ReturnType<typeof parseNota> | null>(null);
  const [rows, setRows] = useState<{ on: boolean; name: string; it: NotaItem }[]>([]);
  const [store, setStore] = useState("");
  const [date, setDate] = useState(todayBR());
  const [done, setDone] = useState("");
  const [launch, setLaunch] = useState(false);
  const read = () => {
    const r = parseNota(text);
    setRes(r); setDone("");
    // nome do mercado: um que voce ja usa com o mesmo comeco, ou o da nota
    const known = r.store ? stores.find((x) => key(r.store!).includes(key(x)) || key(x).includes(key(r.store!).split(" ")[0])) : undefined;
    setStore(known ?? (r.store ? nice(r.store).split(" ").slice(0, 2).join(" ") : ""));
    if (r.date) setDate(r.date);
    setRows(r.items.map((it) => { const k = matchProduct(it.desc, prices); return { on: true, name: k ? prices[k].name : nice(it.desc), it }; }));
  };
  const save = async () => {
    const list = rows.filter((x) => x.on && x.name.trim() && x.it.unitPrice > 0).map((x) => ({ name: x.name.trim(), price: x.it.unitPrice }));
    await onSave(list, date, store.trim() ? cap(store.trim()) : undefined);
    setDone(`${list.length} preços salvos${store.trim() ? ` (${cap(store.trim())}, ${dm(date)})` : ""}.`);
    setText(""); setRes(null); setRows([]);
  };
  const total = rows.filter((x) => x.on).reduce((t, x) => t + x.it.total, 0);
  return (
    <details className="eq-more shop-prod">
      <summary>Importar nota fiscal (NFC-e): salvar todos os preços de uma vez</summary>
      <ol className="small nota-steps">
        <li>No celular, aponte a câmera para o QR code da nota e abra o link (site da Sefaz; ele pode pedir uma verificação).</li>
        <li>Na página da nota, toque e segure no texto, &quot;Selecionar tudo&quot; e &quot;Copiar&quot;.</li>
        <li>Cole aqui embaixo e toque em &quot;Ler itens&quot;. Também funciona com o texto do cupom impresso.</li>
      </ol>
      <textarea className="nota-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Cole aqui o texto da nota..." />
      <div className="row"><button className="primary" type="button" disabled={!text.trim()} onClick={read}>Ler itens</button></div>
      {res && !rows.length && <p className="small warn">Não encontrei itens nesse texto. Copie a página inteira da nota (com &quot;Qtde.&quot; e &quot;Vl. Unit.&quot;).</p>}
      {rows.length > 0 && (
        <>
          <div className="row wrapline">
            <label>Mercado<input value={store} onChange={(e) => setStore(e.target.value)} list="nota-stores" /></label>
            <datalist id="nota-stores">{stores.map((x) => <option key={x} value={x} />)}</datalist>
            <label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <div className="table-scroll">
            <table className="stack nota-table">
              <thead><tr><th /><th>Na nota</th><th>Salvar como</th><th>Qtd</th><th>Preço un.</th><th>Total</th></tr></thead>
              <tbody>
                {rows.map((x, i) => (
                  <tr key={i} className={x.on ? "" : "off"}>
                    <td><input type="checkbox" checked={x.on} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label="Salvar este" /></td>
                    <td data-label="Na nota" className="small">{x.it.desc}</td>
                    <td data-label="Salvar como"><input value={x.name} list="nota-prods" onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></td>
                    <td data-label="Qtd">{fmt(x.it.qty, x.it.qty % 1 ? 3 : 0)} {x.it.unit.toLowerCase()}</td>
                    <td data-label="Preço un.">{brl(x.it.unitPrice)}{x.it.unit === "KG" ? "/kg" : ""}</td>
                    <td data-label="Total">{brl(x.it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="nota-prods">{Object.values(prices).map((p) => <option key={p.name} value={p.name} />)}</datalist>
          </div>
          <p className="small"><b>{rows.filter((x) => x.on).length} itens - {brl(total)}</b>{res?.total ? <span className="muted"> (total da nota {brl(res.total)})</span> : null}</p>
          <div className="row wrapline">
            <button className="primary" type="button" onClick={save}>Salvar os preços</button>
            <button className="ghost" type="button" onClick={() => setLaunch(!launch)}>{launch ? "fechar" : "lançar o gasto da nota"}</button>
          </div>
          {launch && <LaunchForm setup={setup} months={months} estimate={res?.total ?? total} store={store || undefined} onDone={(m) => { setLaunch(false); setDone(m); }} />}
        </>
      )}
      {done && <p className="small pos">&#10003; {done}</p>}
      <Note>&quot;Salvar como&quot; já vem com o produto salvo mais parecido (mesma primeira palavra); troque se quiser juntar com outro nome.
        Itens vendidos por kg salvam o preço do quilo. A nota também marca o dia da compra de cada produto (para a lista sugerida).
        A consulta da nota é feita por você, no site da Sefaz; o SeuBitico só lê o texto que você cola.</Note>
    </details>
  );
}

// Lanca a compra do mercado: valor, data e com o que pagou (conta ou cartao)
function LaunchForm({ setup, months, estimate, store, onDone }: { setup: GastosSetup; months: Record<string, MonthDoc>; estimate: number; store?: string; onDone: (msg: string) => void }) {
  const accs = accountsOf(setup);
  const [v, setV] = useState(estimate > 0 ? fmt(estimate) : "");
  const [d, setD] = useState(todayBR());
  const [desc, setDesc] = useState(store ? `Mercado ${store}` : "Mercado");
  const [src, setSrc] = useState(`acc:${accs[0].id}`);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = num(v);
    if (!(val > 0)) return;
    setBusy(true);
    try {
      const mm = monthOf(d);
      const where = src.startsWith("card:") ? { card: src.slice(5) } : { acc: src.slice(4), io: "out" as const };
      await saveMonth(mm, [...(months[mm]?.items ?? []), { id: newId(), d, desc: desc.trim() || "Mercado", v: val, tipo: "gasto", cat: "Mercado", src: "manual", ...where }]);
      onDone(`Lançado: ${desc.trim() || "Mercado"}, ${brl(val)} em ${dm(d)}.`);
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
