"use client";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge, Button, Card as UiCard, EmptyState, Fold, InfoTip, List, ListRow, Money, Segmented, Sheet, Skeleton, Stat, Stats } from "./ui";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { accountsOf, budgetSpent, monthOf, newId, todayBR, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import { guardWrite, saveMonth } from "./gastosShared";
import { ask, askText } from "./Dialog";

// Lista de compras do mercado: guardada em config/compras (no espaco de quem esta logado).
// freq = quantas vezes cada item ja entrou na lista (atalho "Frequentes")
// prices = produtos salvos: historico de precos (com o mercado), tamanho da embalagem e os dias em que foi comprado
// store/stores = mercado de hoje e os mercados ja usados
type Item = { id: string; name: string; qty?: string; price?: number; done?: boolean };
type PriceRec = { v: number; d: string; s?: string; sz?: number; u?: "kg" | "l" | "un" }; // sz/u: tamanho da embalagem desta compra (ex.: arroz 5 kg ou 1 kg)
type Product = { name: string; hist: PriceRec[]; size?: number; unit?: "kg" | "l" | "un"; buys?: string[]; group?: string; aliases?: string[] };
// group: grupo escolhido pelo dono para comparar (so dentro dele); aliases: textos de nota fiscal ligados a este produto
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
type Sz = { size: number; unit: "kg" | "l" | "un" };
const perLab = (u: Sz["unit"]) => (u === "l" ? "/l" : u === "un" ? "/un" : "/kg");
const szLabel = (z: Sz) => sizeLabel({ name: "", hist: [], size: z.size, unit: z.unit });
// tamanho de um preco: o da compra (sz) ou, sem ele, o tamanho padrao do produto
export const recSize = (p: Product | undefined, h: { sz?: number; u?: Sz["unit"] }): Sz | null =>
  (h.sz ? { size: h.sz, unit: h.u ?? p?.unit ?? "un" } : p?.size ? { size: p.size, unit: p.unit ?? "un" } : null);
// valores para comparar: por kg/l/un quando todos os precos tem tamanho na mesma unidade; senao o preco cheio
export function compVals(p: Product | undefined, hist: PriceRec[]) {
  const sz = hist.map((h) => recSize(p, h));
  const ok = hist.length > 0 && sz.every((z) => z) && sz.every((z) => z!.unit === sz[0]!.unit);
  return ok ? { vals: hist.map((h, i) => h.v / sz[i]!.size), per: true as const, unit: sz[0]!.unit } : { vals: hist.map((h) => h.v), per: false as const, unit: null };
}

// Novo preco x historico do produto (sem contar o registro de hoje): menor, barato, na media ou caro
// size: tamanho do preco novo (sem ele, o tamanho padrao do produto). Com tamanhos, compara por kg/l/un (arroz de 5 kg x de 1 kg)
export function verdict(prod: Product | undefined, v: number, today: string, size?: Sz | null) {
  const prev = (prod?.hist ?? []).filter((h) => h.d !== today).slice(-10);
  if (!prev.length || !(v > 0)) return null;
  const c = compVals(prod, prev);
  const z = size === undefined ? recSize(prod, {}) : size;
  const per = c.per && !!z && z.unit === c.unit;
  const vals = per ? c.vals : prev.map((h) => h.v);
  const x = per ? v / z!.size : v;
  const avg = vals.reduce((t, y) => t + y, 0) / vals.length;
  const min = Math.min(...vals);
  const diff = x / avg - 1;
  const tag = x < min - 0.005 ? { cls: "good", t: "menor preço" } : diff <= -0.03 ? { cls: "good", t: "barato" }
    : diff >= 0.08 ? { cls: "bad", t: `caro (+${fmt(diff * 100, 0)}%)` } : { cls: "", t: "na média" };
  return { ...tag, avg, min, x, per: per ? perLab(z!.unit) : "", last: prev[prev.length - 1] };
}
// Hora de estocar: item que voce compra sempre, no menor preco da sua historia (e pelo menos 5% abaixo da media)
export function stockUp(prod: Product | undefined, v: number, freq: number, today: string) {
  const vd = verdict(prod, v, today);
  const often = freq >= 3 || (prod?.buys?.length ?? 0) >= 2;
  return !!vd && often && vd.x <= vd.min + 0.005 && vd.x <= vd.avg * 0.95;
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
    if (!old || !now || now.d < recent || !(old.v > 0)) continue;
    // compara por kg/l quando os dois precos tem tamanho (mesmo produto comprado em pacotes diferentes)
    const a = recSize(p, old), b = recSize(p, now);
    const per = a && b && a.unit === b.unit;
    ch.push((per ? now.v / b!.size : now.v) / (per ? old.v / a!.size : old.v) - 1);
  }
  return ch.length ? { pct: ch.reduce((t, x) => t + x, 0) / ch.length, n: ch.length } : null;
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
// ---------- produtos salvos: editar sem misturar (24/11/2026) ----------
// Cada produto fica separado; so se compara dentro de um grupo escolhido pelo dono (ex.: "Cafe 500 g")
type Prices = Record<string, Product>;
const byDate = (h: PriceRec[]) => [...h].sort((a, b) => a.d.localeCompare(b.d));
// guarda um preco no produto (um por dia e mercado; ate 60 por produto). alias = texto da nota ligado a este produto
export function addRec(prices: Prices, name: string, rec: PriceRec, opt?: { alias?: string; buy?: boolean }) {
  const k = key(name);
  const p = prices[k] ?? { name: cap(name), hist: [] };
  const hist = p.hist.filter((h) => !(h.d === rec.d && (h.s ?? "") === (rec.s ?? "") && (h.sz ?? 0) === (rec.sz ?? 0)));
  const al = opt?.alias && opt.alias !== k && !(p.aliases ?? []).includes(opt.alias) ? { aliases: [...(p.aliases ?? []), opt.alias] } : {};
  const buys = opt?.buy ? { buys: [...new Set([...(p.buys ?? []), rec.d])].sort().slice(-12) } : {};
  return { ...prices, [k]: { ...p, ...al, ...buys, hist: byDate([...hist, rec]).slice(-60) } };
}
// junta "from" em "to": historicos, compras, apelidos e frequencia; o nome de "from" vira apelido de "to"
export function mergeProducts(prices: Prices, freq: Record<string, number>, from: string, to: string) {
  const a = prices[from], b = prices[to];
  if (!a || !b || from === to) return { prices, freq };
  const seen = new Set<string>();
  const hist = byDate([...b.hist, ...a.hist]).filter((h) => { const id = `${h.d}|${h.s ?? ""}|${h.v}`; if (seen.has(id)) return false; seen.add(id); return true; }).slice(-60);
  const merged: Product = {
    ...b, hist,
    buys: [...new Set([...(b.buys ?? []), ...(a.buys ?? [])])].sort().slice(-12),
    aliases: [...new Set([...(b.aliases ?? []), ...(a.aliases ?? []), from])].filter((x) => x !== to),
    ...(b.size ? {} : a.size ? { size: a.size, unit: a.unit } : {}),
    ...(b.group ? {} : a.group ? { group: a.group } : {}),
  };
  const rest = Object.fromEntries(Object.entries(prices).filter(([k]) => k !== from));
  const f = { ...freq, [to]: (freq[to] ?? 0) + (freq[from] ?? 0) };
  delete f[from];
  return { prices: { ...rest, [to]: merged }, freq: f };
}
// Item da nota -> produto salvo: so liga sozinho quando o texto ja foi ligado antes (apelido) ou e o mesmo nome.
// "parece ser": pelo menos 2 palavras em comum (fora tamanho e palavras curtas) e o mesmo tamanho quando os dois dizem
const SIZE_RE = /\b(\d+(?:[.,]\d+)?)\s?(kg|g|ml|l|lt|un)\b/i;
const sizeOf = (t: string) => { const m = SIZE_RE.exec(t); return m ? parseSize(`${m[1]} ${m[2].toLowerCase() === "lt" ? "l" : m[2]}`) : null; };
const sameSize = (a: { size: number; unit: string } | null, b: { size: number; unit: string } | null) => !a || !b || (a.unit === b.unit && Math.abs(a.size - b.size) < 1e-6);
export function matchNota(desc: string, prices: Prices): { exact?: string; sug?: string } {
  const k = key(desc);
  if (prices[k]) return { exact: k };
  const al = Object.entries(prices).find(([, p]) => (p.aliases ?? []).includes(k));
  if (al) return { exact: al[0] };
  const words = (t: string) => t.replace(SIZE_RE, " ").split(/\s+/).filter((w) => w.length > 2 && !/^\d/.test(w));
  const w = words(k);
  const ds = sizeOf(desc);
  let best: string | undefined, score = 1;
  for (const [pk, p] of Object.entries(prices)) {
    const ps = p.size ? { size: p.size, unit: p.unit ?? "un" } : sizeOf(p.name);
    const sc = words(pk).filter((x) => w.includes(x)).length + (ds && ps && sameSize(ds, ps) ? 0.5 : 0);
    if (sc > score) { best = pk; score = sc; }
  }
  return best ? { sug: best } : {};
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
  const latest = useRef(data);
  latest.current = data;
  const save = async (next: ListDoc) => {
    guardWrite();
    latest.current = next;
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
  const saveNota = async (rows: { name: string; price: number; alias: string; size: Sz | null }[], date: string, store: string | undefined) => {
    const d0 = latest.current;
    const prices = rows.reduce((pr, r) => addRec(pr, r.name, { v: r.price, d: date, ...(store ? { s: store } : {}), ...(r.size ? { sz: r.size.size, u: r.size.unit } : {}) }, { alias: r.alias, buy: true }), d0.prices);
    const stores = store ? [...new Set([...(d0.stores ?? []), store])] : d0.stores;
    await save({ ...d0, prices, stores });
  };
  // editar produtos salvos (sempre sobre o estado mais novo)
  // a tela muda na hora; nao espera o banco (sem internet no mercado, o Firebase envia quando voltar)
  const upd = (fn: (d: ListDoc) => ListDoc) => { void save(fn(latest.current)); return Promise.resolve(); };
  const renameItems = (items: Item[], from: string, name: string) => items.map((x) => (key(x.name) === from ? { ...x, name } : x));
  const [prodOpen, setProdOpen] = useState<string | null>(null);
  const ops: ProdOps = {
    addRec: (name, rec) => upd((d) => ({ ...d, prices: addRec(d.prices, name, rec), ...(rec.s ? { stores: [...new Set([...(d.stores ?? []), rec.s])] } : {}) })),
    patch: (k, pt) => upd((d) => (d.prices[k] ? { ...d, prices: { ...d.prices, [k]: { ...d.prices[k], ...pt } } } : d)),
    rename: async (k, name) => {
      const d = latest.current, nk = key(name);
      if (!d.prices[k] || !name.trim()) return null;
      if (nk === k) { await upd((x) => ({ ...x, prices: { ...x.prices, [k]: { ...x.prices[k], name: cap(name) } } })); return k; }
      if (d.prices[nk]) {
        if (!await ask(`Já existe "${d.prices[nk].name}". Juntar os dois (os preços de "${d.prices[k].name}" passam para ele)?`)) return null;
        await upd((x) => { const m = mergeProducts(x.prices, x.freq, k, nk); return { ...x, ...m, items: renameItems(x.items, k, x.prices[nk].name) }; });
        return nk;
      }
      await upd((x) => {
        const { [k]: p, ...rest } = x.prices;
        const freq = { ...x.freq, [nk]: (x.freq[nk] ?? 0) + (x.freq[k] ?? 0) }; delete freq[k];
        return { ...x, prices: { ...rest, [nk]: { ...p, name: cap(name), aliases: [...new Set([...(p.aliases ?? []), k])] } }, freq, items: renameItems(x.items, k, cap(name)) };
      });
      return nk;
    },
    merge: (from, to) => upd((x) => { const m = mergeProducts(x.prices, x.freq, from, to); return { ...x, ...m, items: renameItems(x.items, from, x.prices[to]?.name ?? to) }; }),
    editRec: (k, i, rec) => upd((x) => {
      const p = x.prices[k]; if (!p) return x;
      const hist = byDate(p.hist.map((h, j) => (j === i ? rec : h)));
      return { ...x, prices: { ...x.prices, [k]: { ...p, hist } }, ...(rec.s ? { stores: [...new Set([...(x.stores ?? []), rec.s])] } : {}) };
    }),
    delRec: (k, i) => upd((x) => { const p = x.prices[k]; return p ? { ...x, prices: { ...x.prices, [k]: { ...p, hist: p.hist.filter((_, j) => j !== i) } } } : x; }),
    moveRec: (k, i, toName) => upd((x) => {
      const p = x.prices[k]; const rec = p?.hist[i]; if (!p || !rec) return x;
      const without = { ...x.prices, [k]: { ...p, hist: p.hist.filter((_, j) => j !== i) } };
      return { ...x, prices: addRec(without, toName, rec) };
    }),
    remove: (k) => upd((x) => ({ ...x, prices: Object.fromEntries(Object.entries(x.prices).filter(([y]) => y !== k)) })),
    addToList: (name) => add(name),
  };
  const setPrice = (x: Item, v: number) => save({
    ...data, items: data.items.map((y) => (y.id === x.id ? { ...y, price: v > 0 ? v : undefined } : y)),
    prices: v > 0 ? addRec(data.prices, x.name, { v, d: today, ...(data.store ? { s: data.store } : {}) }) : data.prices,
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
    <div className="shop shop-v2">
      <div className="shop-top">
        <h1 className="help-title">Lista de compras</h1>
        <InfoTip>Escreva vários itens de uma vez separados por vírgula; a quantidade pode vir antes ou depois (&quot;2 leite&quot;, &quot;sabão 3&quot;).
          Kg/Qtd: unidades ou peso (1,37 kg; 500 g conta como 0,5 kg). Preço un.: o preço da unidade ou do quilo. O preço fica salvo no produto, com o mercado de hoje,
          e o site compara com os anteriores. Depois de 2 compras terminadas ele sabe de quanto em quanto tempo você compra cada coisa.</InfoTip>
      </div>
      <Stats cols={3}>
        <Stat compact label="A comprar" value={<span className="ui-money size-md">{open.length}</span>} />
        <Stat compact label="No carrinho" value={<span className="ui-money size-md">{done.length}</span>} />
        <Stat compact label="Estimado" value={<Money value={est(data.items)} size="md" />} />
      </Stats>

      <UiCard className="shop-addcard">
        <form className="shop-add" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: arroz, 2 leite, café, sabão 3" aria-label="Adicionar itens" />
          <Button type="submit" variant="primary" disabled={!text.trim()} icon={<Plus size={18} aria-hidden="true" />}>Adicionar</Button>
        </form>
        <label className="shop-store small">
          <span className="muted">Mercado de hoje</span>
          <select value={data.store ?? ""} onChange={(e) => void setStore(e.target.value)} aria-label="Mercado de hoje">
            <option value="">não informado</option>
            {(data.stores ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__new">+ novo mercado</option>
          </select>
        </label>
        {dueSoon.length > 0 && (
          <div className="shop-due small">
            <b>Está na hora de comprar</b>
            {dueSoon.slice(0, 10).map(({ k, p, c }) => (
              <button key={k} type="button" className="mes-chip" title={`Você compra a cada ~${c!.every} dias; última vez ${dm(c!.last)}`} onClick={() => add(p.name)}>
                + {p.name} <span className="muted">~{c!.every}d</span></button>
            ))}
            {dueSoon.length > 1 && <Button variant="link" size="sm" onClick={() => add(dueSoon.map((x) => x.p.name).join(", "))}>adicionar todos</Button>}
          </div>
        )}
        {freqChips.length > 0 && (
          <div className="shop-freq small">
            <span className="muted">Frequentes</span>
            {freqChips.map((n) => <button key={n} type="button" className="mes-chip" onClick={() => add(n)}>+ {n}</button>)}
          </div>
        )}
      </UiCard>

      {!loaded ? <div className="ui-loading" role="status" aria-label="Carregando"><Skeleton w="100%" h={52} /><Skeleton w="100%" h={52} /></div> : !data.items.length ? (
        <UiCard><EmptyState title="Lista vazia" text="Escreva os itens acima, vários de uma vez, separados por vírgula." /></UiCard>
      ) : (
        <UiCard flush>
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
                        {prod && <button type="button" className="link" onClick={() => setProdOpen(k)}>ver histórico</button>}
                        {prev.length > 0 && <span className="muted">último {brl(prev[prev.length - 1].v)} ({dm(prev[prev.length - 1].d)}{prev[prev.length - 1].s ? `, ${prev[prev.length - 1].s}` : ""})
                          {prev.length > 1 ? ` - média ${brl(prev.reduce((t, h) => t + h.v, 0) / prev.length)} - menor ${brl(Math.min(...prev.map((h) => h.v)))}` : ""}</span>}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </UiCard>
      )}

      {data.items.length > 0 && (
        <div className="shop-actions-v2">
          {done.length > 0 && <Button variant="primary" block onClick={() => setBuy(true)}>Terminei: lançar o gasto</Button>}
          <div className="shop-actions-row">
            {done.length > 0 && <Button size="sm" onClick={() => finish(done)}>Tirar os marcados</Button>}
            <Button variant="ghost" size="sm" onClick={async () => { if (await ask("Apagar a lista inteira? (os itens frequentes e os preços salvos continuam)")) await save({ ...data, items: [] }); }}>Apagar a lista</Button>
          </div>
        </div>
      )}
      {msg && <p className="ls-msg">&#10003; {msg}</p>}
      {warn && <p className="small warn">{warn}</p>}

      {est(data.items) > 0 && (
        <Fold title="Quanto vai dar" meta={brl(est(data.items))} defaultOpen={!!budget && spentMercado + est(data.items) > budget}>
          <UiCard>
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
          </UiCard>
        </Fold>
      )}

      {infl.length > 0 && (
        <Fold title="Sua inflação no mercado" meta={`${infl[infl.length - 1].n} meses ${infl[infl.length - 1].r!.pct >= 0 ? "+" : ""}${fmt(infl[infl.length - 1].r!.pct * 100, 1)}%`}>
          <UiCard>
            <p className="shop-infl small">
              {infl.map(({ n, r }) => <span key={n} className={r!.pct > 0 ? "neg" : "pos"}>{n} meses {r!.pct >= 0 ? "+" : ""}{fmt(r!.pct * 100, 1)}% <small className="muted">({r!.n} produtos)</small></span>)}
              {ipca12m != null && <span className="muted">IPCA 12 meses {fmt(ipca12m * 100, 1)}%</span>}
            </p>
          </UiCard>
        </Fold>
      )}
      <NotaImport prices={data.prices} stores={data.stores ?? []} setup={setup} months={months} onSave={saveNota} />
      <Products prices={data.prices} freq={data.freq} stores={data.stores ?? []} today={today} open={prodOpen} setOpen={setProdOpen} ops={ops} />

      <Sheet open={buy} onClose={() => setBuy(false)} title="Lançar o gasto do mercado">
        {buy && <div className="ls-form"><LaunchForm setup={setup} months={months} estimate={est(done)} store={data.store} onDone={async (mm) => { setBuy(false); setMsg(mm); await finish(done); }} /></div>}
      </Sheet>
    </div>
  );
}

// Acoes de editar produtos salvos (gravam em config/compras pelo save() da lista)
export type ProdOps = {
  addRec: (name: string, rec: PriceRec) => Promise<void>;
  patch: (k: string, p: Partial<Product>) => Promise<void>;
  rename: (k: string, name: string) => Promise<string | null>; // chave final do produto (null = nada mudou)
  merge: (from: string, to: string) => Promise<void>;
  editRec: (k: string, i: number, rec: PriceRec) => Promise<void>;
  delRec: (k: string, i: number) => Promise<void>;
  moveRec: (k: string, i: number, toName: string) => Promise<void>;
  remove: (k: string) => Promise<void>;
  addToList: (name: string) => Promise<void>;
};

// Produtos salvos: lista com busca; tocar abre a ficha (historico editavel). Compara so dentro do grupo escolhido
function Products({ prices, freq, stores, today, open, setOpen, ops }: {
  prices: Prices; freq: Record<string, number>; stores: string[]; today: string;
  open: string | null; setOpen: (k: string | null) => void; ops: ProdOps;
}) {
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"freq" | "az" | "up">("freq");
  const [adding, setAdding] = useState(false);
  const all = Object.entries(prices);
  const words = key(q).split(/\s+/).filter(Boolean);
  const shown = all.filter(([k, p]) => words.every((w) => k.includes(w) || key(p.group ?? "").includes(w) || (p.aliases ?? []).some((a) => a.includes(w))));
  const last = (p: Product) => p.hist[p.hist.length - 1];
  const rise = (p: Product) => (p.hist.length > 1 ? last(p).v / p.hist[0].v - 1 : 0);
  const sorter = (a: [string, Product], b: [string, Product]) =>
    order === "az" ? a[1].name.localeCompare(b[1].name)
      : order === "up" ? rise(b[1]) - rise(a[1])
      : ((freq[b[0]] ?? 0) + (b[1].buys?.length ?? 0)) - ((freq[a[0]] ?? 0) + (a[1].buys?.length ?? 0)) || a[1].name.localeCompare(b[1].name);
  // grupos escolhidos pelo dono; "mais barata" so quando todos do grupo tem tamanho (preco por kg/l/un)
  const groups = [...new Set(shown.map(([, p]) => p.group).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const cheapest = (g: string) => {
    const mem = all.filter(([, p]) => p.group === g && p.hist.length);
    const per = mem.map(([k, p]) => ({ k, z: recSize(p, last(p)), v: last(p).v }));
    if (mem.length < 2 || !per.every((x) => x.z) || !per.every((x) => x.z!.unit === per[0].z!.unit)) return null;
    return [...per].sort((a, b) => a.v / a.z!.size - b.v / b.z!.size)[0].k;
  };
  const row = ([k, p]: [string, Product], best?: string | null) => {
    const l = last(p);
    // ultimo preco x os anteriores (o proprio registro nao entra na conta)
    const lz = l ? recSize(p, l) : null;
    const vd = l && p.hist.length > 1 ? verdict({ ...p, hist: p.hist.slice(0, -1) }, l.v, "", lz) : null;
    return (
      <ListRow key={k} onClick={() => setOpen(k)} chevron={false}
        title={<>{p.name}{p.size ? <span className="ls-soft"> · {sizeLabel(p)}</span> : null}{best === k && <Badge tone="pos">mais barata</Badge>}</>}
        sub={l ? `${dm(l.d)}${l.s ? ` · ${l.s}` : ""}${lz ? ` · ${l.sz ? `${szLabel(lz)} · ` : ""}${brl(l.v / lz.size)}${perLab(lz.unit)}` : ""}${p.hist.length > 1 ? ` · ${p.hist.length} preços` : ""}` : "sem preço"}
        value={l ? <span className="prod-v"><b>{brl(l.v)}</b>{vd && vd.cls && <small className={vd.cls === "good" ? "pos" : "neg"}>{vd.t}</small>}</span> : undefined} />
    );
  };
  const cur = open ? prices[open] : undefined;
  return (
    <>
    <details className="eq-more shop-prod">
      <summary>Produtos salvos ({all.length}): preços para comparar</summary>
      <div className="prod-tools">
        <label className="ui-search">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto ou grupo..." aria-label="Procurar produto" />
          {q && <button type="button" aria-label="Limpar a busca" onClick={() => setQ("")}><X size={16} aria-hidden="true" /></button>}
        </label>
        <div className="prod-row">
          <Segmented label="Ordem" value={order} onChange={setOrder} options={[{ id: "freq", label: "Mais comprados" }, { id: "az", label: "A–Z" }, { id: "up", label: "Subiu mais" }]} />
          <Button variant="primary" size="sm" icon={<Plus size={15} aria-hidden="true" />} onClick={() => setAdding(true)}>preço</Button>
        </div>
      </div>
      {!all.length ? <p className="mes-line">Nenhum produto salvo ainda. Digite o preço de um item da lista, importe uma nota ou toque em &quot;+ preço&quot;.</p>
        : !shown.length ? <p className="mes-line">Nenhum produto com esse nome.</p> : <>
        {groups.map((g) => {
          const mem = shown.filter(([, p]) => p.group === g).sort(sorter);
          const best = cheapest(g);
          return (
            <div key={g} className="prod-grp">
              <div className="mes-day-h">{g} {!best && mem.length > 1 && <span className="ls-soft">· informe o tamanho de todos para comparar</span>}</div>
              <List>{mem.map((x) => row(x, best))}</List>
            </div>
          );
        })}
        {shown.some(([, p]) => !p.group) && (
          <div className="prod-grp">
            {groups.length > 0 && <div className="mes-day-h">Sem grupo</div>}
            <List>{shown.filter(([, p]) => !p.group).sort(sorter).map((x) => row(x))}</List>
          </div>
        )}
      </>}
    </details>

      <Sheet open={!!cur} onClose={() => setOpen(null)} title={cur?.name} width={620}>
        {cur && open && <ProductSheet key={open} k={open} p={cur} prices={prices} stores={stores} today={today} ops={ops} onClose={() => setOpen(null)} onOpen={setOpen} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Salvar um preço">
        {adding && <NewPrice prices={prices} stores={stores} today={today} onSave={async (name, rec) => { await ops.addRec(name, rec); setAdding(false); }} />}
      </Sheet>
    </>
  );
}

// "+ preco": produto (sugere os salvos), preco, data e mercado
function NewPrice({ prices, stores, today, fixed, onSave }: {
  prices: Prices; stores: string[]; today: string; fixed?: string; onSave: (name: string, rec: PriceRec) => Promise<void>;
}) {
  const [name, setName] = useState(fixed ?? "");
  const [v, setV] = useState("");
  const [d, setD] = useState(today);
  const [s, setS] = useState("");
  const [zt, setZt] = useState("");
  const prev = prices[key(name)];
  const z = zt.trim() ? parseSize(zt) : null;
  const vd = prev && num(v) > 0 ? verdict(prev, num(v), today, z ?? recSize(prev, {})) : null;
  const ok = name.trim() && num(v) > 0 && d && (!zt.trim() || z);
  return (
    <form className="pay-form" onSubmit={async (e) => { e.preventDefault(); if (ok) await onSave(name.trim(), { v: Math.round(num(v) * 100) / 100, d, ...(s.trim() ? { s: cap(s.trim()) } : {}), ...(z ? { sz: z.size, u: z.unit } : {}) }); }}>
      {!fixed && <label>Produto<input value={name} onChange={(e) => setName(e.target.value)} list="prod-names" placeholder="Ex.: Café 500 g" autoFocus /></label>}
      <datalist id="prod-names">{Object.values(prices).map((p) => <option key={p.name} value={p.name} />)}</datalist>
      <div className="pay-row">
        <label>Preço (R$)<input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} placeholder="0,00" /></label>
        <label>Data<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
      </div>
      <div className="pay-row">
        <label>Mercado (opcional)<input value={s} onChange={(e) => setS(e.target.value)} list="prod-stores" placeholder="onde comprou" /></label>
        <label>Tamanho desta compra<input value={zt} onChange={(e) => setZt(e.target.value)} placeholder={prev?.size ? sizeLabel(prev) : "ex.: 5 kg, 1 l"} aria-invalid={!!zt.trim() && !z} /></label>
      </div>
      <datalist id="prod-stores">{stores.map((x) => <option key={x} value={x} />)}</datalist>
      {zt.trim() && !z && <p className="mes-line warn">Tamanho não entendido. Use 500 g, 5 kg, 900 ml, 2 l ou 12 un.</p>}
      {z && num(v) > 0 && <p className="mes-line">Sai a {brl(num(v) / z.size)}{perLab(z.unit)}.</p>}
      {!fixed && name.trim() && <p className="mes-line">{prev ? <>Vai para o produto salvo <b>{prev.name}</b> ({prev.hist.length} preços).</> : "Produto novo."}</p>}
      {vd && <p className="mes-line"><span className={`shop-tag ${vd.cls}`}>{vd.t}</span> média {brl(vd.avg)}{vd.per} · menor {brl(vd.min)}{vd.per}</p>}
      <Button type="submit" variant="primary" block disabled={!ok}>Salvar preço</Button>
    </form>
  );
}

// Ficha do produto: nome, tamanho, grupo, resumo, historico (alterar / apagar / mover) e juntar com outro
function ProductSheet({ k, p, prices, stores, today, ops, onClose, onOpen }: {
  k: string; p: Product; prices: Prices; stores: string[]; today: string; ops: ProdOps; onClose: () => void; onOpen: (k: string) => void;
}) {
  const [name, setName] = useState(p.name);
  const [size, setSize] = useState(sizeLabel(p));
  const [group, setGroup] = useState(p.group ?? "");
  const [edit, setEdit] = useState<number | null>(null);
  const [ev, setEv] = useState({ v: "", d: "", s: "", z: "" });
  const [moving, setMoving] = useState<number | null>(null);
  const [mergeTo, setMergeTo] = useState("");
  const [adding, setAdding] = useState(false);
  const others = Object.entries(prices).filter(([o]) => o !== k).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const groups = [...new Set(Object.values(prices).map((x) => x.group).filter(Boolean) as string[])].sort();
  // com tamanho em todos os precos, o resumo, o grafico e o "mais barato em" sao por kg/l/un
  const cv = compVals(p, p.hist);
  const vals = cv.vals;
  const pl = cv.per ? perLab(cv.unit) : "";
  const l = p.hist[p.hist.length - 1];
  const lz = l ? recSize(p, l) : null;
  const st: Record<string, number> = {};
  p.hist.forEach((h, i) => { if (h.s) st[h.s] = vals[i]; });
  const byStore = Object.entries(st).sort((a, b) => a[1] - b[1]);
  const evZ = ev.z.trim() ? parseSize(ev.z) : null;
  const sizeOk = !size.trim() || parseSize(size);
  const dirty = name.trim() !== p.name || (size.trim() ? sizeLabel(p) !== size.trim() : !!p.size) || group.trim() !== (p.group ?? "");
  const saveInfo = async () => {
    const patch: Partial<Product> = { group: group.trim() ? cap(group.trim()) : undefined };
    if (size.trim()) { const s = parseSize(size); if (s) Object.assign(patch, s); } else Object.assign(patch, { size: undefined, unit: undefined });
    await ops.patch(k, patch);
    if (name.trim() && name.trim() !== p.name) {
      const nk = await ops.rename(k, name.trim());
      if (nk === null) setName(p.name); // cancelou a juncao: volta o nome
      else if (nk !== k) onOpen(nk);
    }
  };
  const rows = p.hist.map((h, i) => ({ h, i })).reverse();
  return (
    <div className="prod-sheet">
      <div className="prod-info">
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="pay-row">
          <label>Tamanho padrão<input value={size} onChange={(e) => setSize(e.target.value)} placeholder="ex.: 500 g, 1 l, 12 un" aria-invalid={!sizeOk} /></label>
          <label>Grupo para comparar<input value={group} onChange={(e) => setGroup(e.target.value)} list="prod-groups" placeholder="ex.: Café 500 g" /></label>
        </div>
        <datalist id="prod-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        {!sizeOk && <p className="mes-line warn">Tamanho não entendido. Use 500 g, 1 kg, 900 ml, 2 l ou 12 un.</p>}
        {dirty && <Button variant="primary" size="sm" disabled={!sizeOk || !name.trim()} onClick={saveInfo}>Salvar nome, tamanho e grupo</Button>}
      </div>

      {l && (
        <div className="prod-sum">
          <div><span>Último{lz ? ` (${szLabel(lz)})` : ""}</span><b>{brl(l.v)}</b><small>{dm(l.d)}{l.s ? ` · ${l.s}` : ""}</small></div>
          {lz && <div><span>Último por {lz.unit === "un" ? "unidade" : lz.unit === "l" ? "litro" : "kg"}</span><b>{brl(l.v / lz.size)}</b></div>}
          <div><span>Menor{pl}</span><b className="pos">{brl(Math.min(...vals))}</b></div>
          <div><span>Média{pl}</span><b>{brl(vals.reduce((t, x) => t + x, 0) / vals.length)}</b></div>
          <div><span>Maior{pl}</span><b className="neg">{brl(Math.max(...vals))}</b></div>
          <div className="prod-spark"><Spark hist={p.hist.map((h, i) => ({ ...h, v: vals[i] }))} /></div>
        </div>
      )}
      {byStore.length > 1 && <p className="mes-line">Mais barato em: {byStore.map(([s, v], i) => <span key={s} className={i === 0 ? "pos" : ""}>{i > 0 ? " · " : ""}{s} {brl(v)}{pl}</span>)}</p>}
      {!cv.per && p.hist.length > 1 && p.hist.some((h) => h.sz) && <p className="mes-line">Informe o tamanho de todos os preços (ou o tamanho padrão acima) para comparar por kg/litro.</p>}

      <div className="prod-hist-head"><b>Histórico de preços</b>
        <Button variant="link" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setAdding(!adding)}>{adding ? "fechar" : "preço"}</Button></div>
      {adding && <UiCard><NewPrice prices={prices} stores={stores} today={today} fixed={p.name} onSave={async (n, rec) => { await ops.addRec(n, rec); setAdding(false); }} /></UiCard>}
      {rows.length ? (
        <div className="ui-list prod-hist">
          {rows.map(({ h, i }) => (
            <div key={`${h.d}-${h.s ?? ""}-${i}`} className="prod-rec">
              {edit === i ? (
                <form className="prod-rec-edit" onSubmit={async (e) => { e.preventDefault(); if (!(num(ev.v) > 0) || !ev.d || (ev.z.trim() && !evZ)) return; await ops.editRec(k, i, { v: Math.round(num(ev.v) * 100) / 100, d: ev.d, ...(ev.s.trim() ? { s: cap(ev.s.trim()) } : {}), ...(evZ ? { sz: evZ.size, u: evZ.unit } : {}) }); setEdit(null); }}>
                  <input value={ev.v} inputMode="decimal" onChange={(e) => setEv({ ...ev, v: e.target.value })} aria-label="Preço" />
                  <input type="date" value={ev.d} onChange={(e) => setEv({ ...ev, d: e.target.value })} aria-label="Data" />
                  <input value={ev.s} onChange={(e) => setEv({ ...ev, s: e.target.value })} list="prod-stores" placeholder="mercado" aria-label="Mercado" />
                  <input value={ev.z} onChange={(e) => setEv({ ...ev, z: e.target.value })} placeholder={p.size ? `tamanho (${sizeLabel(p)})` : "tamanho (ex.: 5 kg)"} aria-label="Tamanho desta compra" aria-invalid={!!ev.z.trim() && !evZ} />
                  {evZ && num(ev.v) > 0 && <span className="mes-line">{brl(num(ev.v) / evZ.size)}{perLab(evZ.unit)}</span>}
                  <datalist id="prod-stores">{stores.map((x) => <option key={x} value={x} />)}</datalist>
                  <Button type="submit" variant="primary" size="sm">Salvar</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>Cancelar</Button>
                </form>
              ) : moving === i ? (
                <div className="prod-rec-edit">
                  <span className="mes-line">Mover {brl(h.v)} de {dm(h.d)} para:</span>
                  <select defaultValue="" onChange={async (e) => {
                    const v = e.target.value; if (!v) return;
                    const to = v === "__new" ? (await askText("Nome do produto novo:", ""))?.trim() : prices[v]?.name;
                    if (!to) return;
                    await ops.moveRec(k, i, to); setMoving(null);
                  }} aria-label="Mover para qual produto">
                    <option value="">escolha o produto...</option>
                    <option value="__new">+ produto novo</option>
                    {others.map(([o, x]) => <option key={o} value={o}>{x.name}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => setMoving(null)}>Cancelar</Button>
                </div>
              ) : (
                <>
                  <span className="prod-rec-d">{dm(h.d)}/{h.d.slice(2, 4)}</span>
                  <span className="prod-rec-s">{h.s ?? <span className="ls-soft">sem mercado</span>}
                    {(() => { const z = recSize(p, h); return z ? <small className="prod-rec-z">{h.sz ? szLabel(z) : `${szLabel(z)} (padrão)`} · {brl(h.v / z.size)}{perLab(z.unit)}</small> : null; })()}</span>
                  <b className="prod-rec-v">{brl(h.v)}</b>
                  <span className="prod-rec-acts">
                    <Button variant="icon" size="sm" aria-label={`Alterar o preço de ${dm(h.d)}`} icon={<Pencil size={14} aria-hidden="true" />}
                      onClick={() => { setMoving(null); setEv({ v: fmt(h.v), d: h.d, s: h.s ?? "", z: h.sz ? szLabel({ size: h.sz, unit: h.u ?? p.unit ?? "un" }) : "" }); setEdit(i); }} />
                    <Button variant="icon" size="sm" aria-label={`Mover o preço de ${dm(h.d)} para outro produto`} icon={<ArrowRightLeft size={14} aria-hidden="true" />}
                      onClick={() => { setEdit(null); setMoving(i); }} />
                    <Button variant="icon" size="sm" aria-label={`Apagar o preço de ${dm(h.d)}`} icon={<Trash2 size={14} aria-hidden="true" />}
                      onClick={async () => { if (await ask(`Apagar o preço ${brl(h.v)} de ${dm(h.d)}${h.s ? ` (${h.s})` : ""}?`)) await ops.delRec(k, i); }} />
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      ) : <p className="mes-line">Nenhum preço ainda.</p>}

      {(p.aliases ?? []).length > 0 && (
        <div className="prod-alias">
          <span className="mes-line">Nomes da nota ligados a este produto:</span>
          {(p.aliases ?? []).map((a) => (
            <span key={a} className="mes-chip">{a}
              <button type="button" aria-label={`Desligar "${a}"`} onClick={() => ops.patch(k, { aliases: (p.aliases ?? []).filter((x) => x !== a) })}><X size={12} aria-hidden="true" /></button></span>
          ))}
        </div>
      )}

      <div className="prod-acts">
        <Button size="sm" icon={<Plus size={15} aria-hidden="true" />} onClick={async () => { await ops.addToList(p.name); onClose(); }}>Pôr na lista</Button>
        {others.length > 0 && (
          <span className="prod-merge">
            <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} aria-label="Juntar com qual produto">
              <option value="">Juntar com outro produto...</option>
              {others.map(([o, x]) => <option key={o} value={o}>{x.name}</option>)}
            </select>
            {mergeTo && <Button size="sm" onClick={async () => {
              if (!await ask(`Juntar "${p.name}" com "${prices[mergeTo].name}"? Os preços passam para "${prices[mergeTo].name}" e "${p.name}" deixa de existir.`)) return;
              const to = mergeTo; await ops.merge(k, to); setMergeTo(""); onOpen(to);
            }}>Juntar</Button>}
          </span>
        )}
        <Button variant="danger" size="sm" icon={<Trash2 size={15} aria-hidden="true" />} onClick={async () => { if (await ask(`Apagar o produto "${p.name}" e os ${p.hist.length} preços dele?`)) { await ops.remove(k); onClose(); } }}>Apagar produto</Button>
      </div>
    </div>
  );
}

// Importar a nota fiscal: colar o texto da pagina da nota (aberta pelo QR code no celular), conferir e salvar os precos.
// So liga sozinho a um produto salvo o que ja foi ligado antes (apelido) ou tem o mesmo nome; o resto vira produto novo,
// com "parece ser X" para voce confirmar (24/11/2026: a ligacao pela 1a palavra misturava produtos diferentes)
type NotaRow = { on: boolean; target: string; name: string; sug?: string; it: NotaItem }; // target "" = produto novo com "name"
function NotaImport({ prices, stores, setup, months, onSave }: {
  prices: Prices; stores: string[]; setup: GastosSetup; months: Record<string, MonthDoc>;
  onSave: (rows: { name: string; price: number; alias: string; size: Sz | null }[], date: string, store: string | undefined) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<ReturnType<typeof parseNota> | null>(null);
  const [rows, setRows] = useState<NotaRow[]>([]);
  const [store, setStore] = useState("");
  const [date, setDate] = useState(todayBR());
  const [done, setDone] = useState("");
  const [launch, setLaunch] = useState(false);
  const read = () => {
    const r = parseNota(text);
    setRes(r); setDone("");
    // nome do mercado: um que voce ja usa com o mesmo comeco, ou o da nota
    // a 1a palavra que identifica o mercado (pula "mercado", "supermercado"... que muitos tem no nome)
    const GENERIC = ["mercado", "supermercado", "super", "supermercados", "mercados", "atacado", "atacadao", "comercial", "comercio", "loja", "lojas", "rede", "cia", "cooperativa", "ltda", "eireli", "epp"];
    const id = r.store ? key(r.store).split(/\s+/).find((x) => x.length > 2 && !GENERIC.includes(x)) : undefined;
    const known = r.store ? stores.find((x) => key(r.store!).includes(key(x)) || (!!id && key(x).split(/\s+/).includes(id))) : undefined;
    setStore(known ?? (r.store ? nice(r.store).split(" ").slice(0, 2).join(" ") : ""));
    if (r.date) setDate(r.date);
    setRows(r.items.map((it) => { const m = matchNota(it.desc, prices); return { on: true, target: m.exact ?? "", name: nice(it.desc), sug: m.sug, it }; }));
  };
  const set = (i: number, p: Partial<NotaRow>) => setRows(rows.map((y, j) => (j === i ? { ...y, ...p } : y)));
  const save = async () => {
    const list = rows.filter((x) => x.on && x.it.unitPrice > 0 && (x.target || x.name.trim()))
      .map((x) => ({ name: x.target ? prices[x.target].name : x.name.trim(), price: x.it.unitPrice, alias: key(x.it.desc),
        size: x.it.unit === "KG" ? { size: 1, unit: "kg" as const } : sizeOf(x.it.desc) }));
    await onSave(list, date, store.trim() ? cap(store.trim()) : undefined);
    setDone(`${list.length} preços salvos${store.trim() ? ` (${cap(store.trim())}, ${dm(date)})` : ""}.`);
    setText(""); setRes(null); setRows([]);
  };
  const total = rows.filter((x) => x.on).reduce((t, x) => t + x.it.total, 0);
  const opts = Object.entries(prices).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return (
    <details className="eq-more shop-prod">
      <summary>Importar nota fiscal (NFC-e): salvar todos os preços de uma vez</summary>
      <ol className="small nota-steps">
        <li>No celular, aponte a câmera para o QR code da nota e abra o link (site da Sefaz; ele pode pedir uma verificação).</li>
        <li>Na página da nota, toque e segure no texto, &quot;Selecionar tudo&quot; e &quot;Copiar&quot;.</li>
        <li>Cole aqui embaixo e toque em &quot;Ler itens&quot;. Também funciona com o texto do cupom impresso.</li>
      </ol>
      <textarea className="nota-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Cole aqui o texto da nota..." />
      <div className="row"><Button variant="primary" disabled={!text.trim()} onClick={read}>Ler itens</Button></div>
      {res && !rows.length && <p className="small warn">Não encontrei itens nesse texto. Copie a página inteira da nota (com &quot;Qtde.&quot; e &quot;Vl. Unit.&quot;).</p>}
      {rows.length > 0 && (
        <>
          <div className="pay-row nota-head">
            <label>Mercado<input value={store} onChange={(e) => setStore(e.target.value)} list="nota-stores" /></label>
            <datalist id="nota-stores">{stores.map((x) => <option key={x} value={x} />)}</datalist>
            <label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <p className="mes-line">Confira cada item: <b>ligado</b> = já foi ligado antes; <b>novo</b> = vira produto novo. Se for o mesmo de um salvo, escolha em &quot;Salvar em&quot; (ou toque em &quot;usar&quot;).</p>
          <div className="ui-list nota-list">
            {rows.map((x, i) => (
              <div key={i} className={x.on ? "nota-row" : "nota-row off"}>
                <label className="nota-check"><input type="checkbox" checked={x.on} onChange={(e) => set(i, { on: e.target.checked })} aria-label="Salvar este" />
                  <span className="nota-desc">{x.it.desc}</span>
                  <span className="nota-v">{brl(x.it.unitPrice)}{x.it.unit === "KG" ? "/kg" : ""}<small> · {fmt(x.it.qty, x.it.qty % 1 ? 3 : 0)} {x.it.unit.toLowerCase()}</small></span></label>
                {x.on && <div className="nota-to">
                  <Badge tone={x.target ? "pos" : "info"}>{x.target ? "ligado" : "novo"}</Badge>
                  <select value={x.target} onChange={(e) => set(i, { target: e.target.value })} aria-label="Salvar em">
                    <option value="">novo produto: {x.name}</option>
                    {opts.map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
                  </select>
                  {!x.target && <input value={x.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Nome do produto novo" />}
                  {!x.target && x.sug && prices[x.sug] && <span className="nota-sug">parece ser <b>{prices[x.sug].name}</b>
                    <Button variant="link" size="sm" onClick={() => set(i, { target: x.sug! })}>usar</Button></span>}
                </div>}
              </div>
            ))}
          </div>
          <p className="small"><b>{rows.filter((x) => x.on).length} itens - {brl(total)}</b>{res?.total ? <span className="muted"> (total da nota {brl(res.total)})</span> : null}</p>
          <div className="row wrapline">
            <Button variant="primary" onClick={save}>Salvar os preços</Button>
            <Button variant="ghost" onClick={() => setLaunch(!launch)}>{launch ? "fechar" : "lançar o gasto da nota"}</Button>
          </div>
          {launch && <LaunchForm setup={setup} months={months} estimate={res?.total ?? total} store={store || undefined} onDone={(m) => { setLaunch(false); setDone(m); }} />}
        </>
      )}
      {done && <p className="small pos">&#10003; {done}</p>}
      <p className="mes-line">Ao salvar, o texto da nota fica ligado ao produto escolhido: na próxima nota ele já vem ligado. Itens vendidos por kg salvam o preço do quilo.
        A consulta da nota é feita por você, no site da Sefaz; o SeuBitico só lê o texto que você cola.</p>
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
