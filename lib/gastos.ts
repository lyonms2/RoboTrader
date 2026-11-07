// Controle de gastos: lancamentos por mes, cartoes (faturas e parcelas), emprestimos e gastos fixos.
// Tudo fica em config/* (unica pasta que o navegador pode gravar pelas regras do Firestore):
//   config/gastos-AAAA-MM  -> { items: Gasto[] }  (um documento por mes)
//   config/gastos-setup    -> GastosSetup         (cartoes, emprestimos, fixos, regras de categoria)

export type Tipo = "gasto" | "receita" | "neutro"; // neutro = nao conta (pagamento de fatura, aplicacao, transferencia propria)
export type Gasto = {
  id: string;
  d: string; // AAAA-MM-DD (data da compra / do pagamento)
  desc: string;
  v: number; // sempre positivo
  tipo: Tipo;
  cat: string;
  src?: "manual" | "import" | "fixo" | "parcela" | "emprestimo";
  ext?: string; // id da transacao no extrato (evita importar duas vezes)
  card?: string; // id do cartao (compra no credito)
  parc?: [number, number]; // parcela k de n
  ref?: string; // id do fixo / emprestimo que gerou o lancamento
};
export type MonthDoc = { items: Gasto[] };
export type Card = { id: string; name: string; closeDay: number; dueDay: number; limit?: number };
export type Loan = {
  id: string; name: string;
  parcela: number; // R$ por mes
  n: number; // total de parcelas
  first: string; // AAAA-MM da 1a parcela
  dueDay: number;
  rate?: number; // juros % ao mes (opcional: deixa o saldo devedor mais certo)
};
export type Fixo = { id: string; desc: string; v: number; cat: string; dia: number; card?: string };
export type GastosSetup = { cards: Card[]; loans: Loan[]; fixos: Fixo[]; rules: Record<string, string>; categories?: string[] };
export const EMPTY_SETUP: GastosSetup = { cards: [], loans: [], fixos: [], rules: {} };

export const CATS_GASTO = [
  "Moradia", "Mercado", "Alimentacao", "Transporte", "Saude", "Assinaturas", "Contas (luz, agua, internet)", "Compras",
  "Educacao", "Lazer e viagem", "Pix e transferencias", "Emprestimos", "Impostos e tarifas", "Outros",
];
export const CATS_RECEITA = ["Salario", "Renda extra", "Rendimentos", "Pix recebido", "Outras entradas"];
export const CATS_NEUTRO = ["Fatura do cartao", "Investimento", "Transferencia entre contas"];
export const tipoOfCat = (c: string): Tipo | null =>
  CATS_NEUTRO.includes(c) ? "neutro" : CATS_RECEITA.includes(c) ? "receita" : CATS_GASTO.includes(c) ? "gasto" : null;

// Palavras-chave comuns em extratos brasileiros -> categoria (a primeira que bater)
const KEYWORDS: [RegExp, string][] = [
  [/pagamento (de )?fatura|pagamento recebido|pgto fatura|fatura cart/, "Fatura do cartao"],
  [/aplica[cç][aã]o|resgate|\brdb\b|\bcdb\b|tesouro|caixinha|cofrinho|corretora|invest/, "Investimento"],
  [/sal[aá]rio|folha de pag|proventos? de sal/, "Salario"],
  [/rendimento|juros sobre|dividendo/, "Rendimentos"],
  [/ifood|rappi|restaurante|lanchonete|padaria|burger|mc ?donald|pizza|sushi|churrasc|\bbar\b|cafe|cafeteria|delivery/, "Alimentacao"],
  [/supermerc|mercado(?! ?livre|pago)|atacad|assa[ií]|carrefour|p[aã]o de a[cç]|hortifruti|a[cç]ougue|sacol[aã]o|dia %|\bextra\b/, "Mercado"],
  [/uber|\b99 ?(app|pop|taxi)?\b|posto|combust|shell|ipiranga|petrobras|estaciona|sem parar|conectcar|ped[aá]gio|metr[oô]|[oô]nibus|bilhete [uú]nico|recarga bu/, "Transporte"],
  [/aluguel|condom[ií]nio|imobili[aá]ria/, "Moradia"],
  [/enel|cemig|copel|light s|celesc|coelba|energia|sabesp|copasa|sanepar|[aá]gua e esgoto|comg[aá]s|\bg[aá]s\b|vivo|claro|\btim\b|\boi\b|internet|telefon/, "Contas (luz, agua, internet)"],
  [/netflix|spotify|prime video|amazon prime|disney|hbo|\bmax\b|globoplay|youtube|apple\.com|icloud|google (one|storage)|chatgpt|openai|deezer|paramount/, "Assinaturas"],
  [/farm[aá]cia|drogaria|droga ?raia|drogasil|pague menos|panvel|hospital|cl[ií]nica|laborat|unimed|amil|hapvida|odonto|m[eé]dic|dentista|psic/, "Saude"],
  [/amazon|mercado ?livre|mercadolivre|shopee|magalu|magazine luiza|americanas|aliexpress|shein|renner|riachuelo|c&a|centauro|netshoes|kabum/, "Compras"],
  [/escola|col[eé]gio|curso|faculdade|universidade|udemy|alura|livraria|mensalidade/, "Educacao"],
  [/cinema|ingresso|steam|playstation|xbox|nintendo|hotel|airbnb|booking|latam|\bgol\b|azul linhas|decolar|viagem/, "Lazer e viagem"],
  [/\biof\b|tarifa|anuidade|juros|multa|ipva|iptu|darf|imposto|taxa/, "Impostos e tarifas"],
  [/empr[eé]stimo|financiamento|consignado|parcela cr[eé]dito/, "Emprestimos"],
  [/pix|transfer[eê]ncia|\bted\b|\bdoc\b/, "Pix e transferencias"],
];

// Chave da descricao para lembrar a categoria escolhida (sem numeros, datas e codigos)
export function descKey(desc: string) {
  return desc.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/parcela \d+\/\d+/g, "")
    .replace(/[^a-z ]+/g, " ").split(" ").filter((w) => w.length > 1).slice(0, 3).join(" ");
}

// Categoria automatica: 1) o que voce ja escolheu para essa descricao, 2) palavras-chave, 3) padrao pelo sinal
export function categorize(desc: string, entrada: boolean, rules: Record<string, string>): { cat: string; tipo: Tipo } {
  const learned = rules[descKey(desc)];
  if (learned && tipoOfCat(learned)) return { cat: learned, tipo: tipoOfCat(learned)! };
  const low = desc.toLowerCase();
  for (const [re, cat] of KEYWORDS) {
    if (!re.test(low)) continue;
    const t = tipoOfCat(cat)!;
    if (t === "neutro") return { cat, tipo: t };
    if (entrada && t === "gasto") return { cat: /pix|transfer/.test(low) ? "Pix recebido" : "Outras entradas", tipo: "receita" };
    if (!entrada && t === "receita") continue;
    return { cat, tipo: t };
  }
  return entrada ? { cat: "Outras entradas", tipo: "receita" } : { cat: "Outros", tipo: "gasto" };
}

// ---------- datas ----------
export const monthOf = (d: string) => d.slice(0, 7);
export const addMonths = (m: string, k: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + k, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const todayBR = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
export const dayIn = (m: string, dia: number) => `${m}-${String(Math.min(dia, lastDay(m))).padStart(2, "0")}`;
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// "nov/26" ou "Novembro de 2026"
export const monthLabel = (m: string, long = false) => {
  const name = MESES[Number(m.slice(5, 7)) - 1];
  return long ? `${name[0].toUpperCase()}${name.slice(1)} de ${m.slice(0, 4)}` : `${name.slice(0, 3)}/${m.slice(2, 4)}`;
};
export const newId = () => Math.random().toString(36).slice(2, 10);

// ---------- cartoes ----------
// Mes de vencimento da fatura em que cai uma compra: compra antes do fechamento entra na fatura que fecha neste mes
export function faturaMonth(card: Card, d: string) {
  const closeMonth = Number(d.slice(8, 10)) < card.closeDay ? monthOf(d) : addMonths(monthOf(d), 1);
  return card.dueDay > card.closeDay ? closeMonth : addMonths(closeMonth, 1);
}

// ---------- emprestimos ----------
// Parcelas ja vencidas ate hoje, restantes, saldo devedor (valor presente com juros, ou soma simples) e quitacao
export function loanStatus(l: Loan, today = todayBR()) {
  let paid = 0;
  for (let k = 0; k < l.n; k++) if (dayIn(addMonths(l.first, k), l.dueDay) <= today) paid++;
  const left = l.n - paid;
  const r = (l.rate ?? 0) / 100;
  const saldo = r > 0 ? (l.parcela * (1 - (1 + r) ** -left)) / r : l.parcela * left;
  return { paid, left, saldo, end: addMonths(l.first, l.n - 1), next: left > 0 ? dayIn(addMonths(l.first, paid), l.dueDay) : null };
}
// Parcela do emprestimo que vence no mes m (null se fora do prazo)
export function loanInstallment(l: Loan, m: string) {
  const k = monthDiff(l.first, m);
  return k >= 0 && k < l.n ? k + 1 : null;
}
export const monthDiff = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// ---------- resumo ----------
export type MonthSummary = { gastos: number; receitas: number; byCat: Record<string, number> };
export function summarize(items: Gasto[]): MonthSummary {
  const s: MonthSummary = { gastos: 0, receitas: 0, byCat: {} };
  for (const i of items) {
    if (i.tipo === "gasto") { s.gastos += i.v; s.byCat[i.cat] = (s.byCat[i.cat] ?? 0) + i.v; }
    else if (i.tipo === "receita") s.receitas += i.v;
  }
  return s;
}
// Media de gastos dos ultimos 3 meses fechados que tem lancamentos (usada na reserva de emergencia)
export function avgMonthly(months: Record<string, MonthDoc>, current = monthOf(todayBR())) {
  const keys = Object.keys(months).filter((m) => m < current && months[m].items.some((i) => i.tipo === "gasto")).sort().slice(-3);
  if (!keys.length) return null;
  return { value: keys.reduce((s, m) => s + summarize(months[m].items).gastos, 0) / keys.length, months: keys.length };
}

// Previstos do mes que ainda nao foram lancados: gastos fixos e parcelas de emprestimo.
// Considera pago se ja existe lancamento ligado a ele, ou um gasto com valor parecido (2%) na mesma categoria.
export function pendingFor(m: string, items: Gasto[], setup: GastosSetup) {
  const used = new Set<string>();
  const match = (ref: string, v: number, cat: string) => {
    const hit = items.find((i) => !used.has(i.id) && i.tipo === "gasto" && (i.ref === ref || (i.cat === cat && Math.abs(i.v - v) <= v * 0.02)));
    if (hit) used.add(hit.id);
    return !!hit;
  };
  const out: { ref: string; desc: string; v: number; cat: string; d: string; card?: string; parc?: [number, number] }[] = [];
  for (const f of setup.fixos) if (!match(f.id, f.v, f.cat)) out.push({ ref: f.id, desc: f.desc, v: f.v, cat: f.cat, d: dayIn(m, f.dia), card: f.card });
  for (const l of setup.loans) {
    const k = loanInstallment(l, m);
    if (k && !match(l.id, l.parcela, "Emprestimos")) out.push({ ref: l.id, desc: `${l.name} (parcela ${k}/${l.n})`, v: l.parcela, cat: "Emprestimos", d: dayIn(m, l.dueDay), parc: [k, l.n] });
  }
  return out;
}

// ---------- importacao de extrato ----------
export type Raw = { d: string; desc: string; amount: number; ext: string }; // amount < 0 = saida
const toNum = (s: string) => {
  let t = s.replace(/[\sR$"]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return Number(t);
};
const toIso = (s: string) => {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{8}/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return "";
};

// Le o arquivo (OFX costuma vir em Windows-1252)
export function decode(buf: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

// OFX: padrao de quase todos os bancos (Nubank, Itau, Inter, BB, Bradesco, Santander, Caixa)
export function parseOFX(text: string): Raw[] {
  const out: Raw[] = [];
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  for (const b of text.split(/<STMTTRN>/i).slice(1)) {
    const d = toIso(tag(b, "DTPOSTED"));
    const amount = Number(tag(b, "TRNAMT").replace(",", "."));
    const desc = tag(b, "MEMO") || tag(b, "NAME") || "(sem descricao)";
    if (!d || !Number.isFinite(amount)) continue;
    out.push({ d, desc, amount, ext: tag(b, "FITID") || `${d}|${desc}|${amount}` });
  }
  return out;
}

function splitCsv(line: string, sep: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// CSV: Nubank conta (Data,Valor,Identificador,Descricao), Nubank cartao (date,title,amount) e outros com cabecalho parecido.
// cardStyle = valores positivos sao compras (fatura de cartao); nesse caso o sinal e invertido.
export function parseCSV(text: string): { rows: Raw[]; cardStyle: boolean; error?: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], cardStyle: false, error: "arquivo vazio" };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = splitCsv(lines[0], sep).map((h) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iD = find(/^data|date/);
  const iV = find(/valor|amount|value|quantia/);
  const iDesc = find(/descri|title|historico|lancamento|estabelecimento|memo/);
  const iId = find(/identificador|^id$|fitid/);
  if (iD < 0 || iV < 0 || iDesc < 0) return { rows: [], cardStyle: false, error: "nao encontrei as colunas de data, valor e descricao no cabecalho" };
  const rows: Raw[] = [];
  const seen: Record<string, number> = {};
  for (const l of lines.slice(1)) {
    const c = splitCsv(l, sep);
    const d = toIso(c[iD] ?? "");
    const amount = toNum(c[iV] ?? "");
    const desc = c[iDesc] || "(sem descricao)";
    if (!d || !Number.isFinite(amount)) continue;
    const base = iId >= 0 && c[iId] ? c[iId] : `${d}|${desc}|${amount}`;
    seen[base] = (seen[base] ?? 0) + 1; // mesma compra duas vezes no mesmo dia
    rows.push({ d, desc, amount, ext: seen[base] > 1 ? `${base}#${seen[base]}` : base });
  }
  const cardStyle = head.includes("title") || rows.filter((r) => r.amount > 0).length > rows.length * 0.7;
  return { rows: cardStyle ? rows.map((r) => ({ ...r, amount: -r.amount })) : rows, cardStyle };
}

// "Parcela 2/10" ou "2/10" no fim da descricao
export function parcOf(desc: string): [number, number] | undefined {
  const m = desc.match(/(?:parcela\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i) ?? desc.match(/parcela\s*(\d{1,2})\s*de\s*(\d{1,2})/i);
  if (!m) return undefined;
  const k = Number(m[1]);
  const n = Number(m[2]);
  return k >= 1 && n >= 2 && k <= n ? [k, n] : undefined;
}

// ---------- dividas ----------
// Dividas em aberto: saldo dos emprestimos + faturas de cartao ainda nao vencidas (inclui parcelas futuras)
export function debts(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const today = todayBR();
  const loans = setup.loans.reduce((s, l) => s + loanStatus(l, today).saldo, 0);
  const cards = setup.cards.map((c) => cardStatus(c, months, today));
  return { loans, cards: cards.reduce((s, c) => s + c.open, 0), total: loans + cards.reduce((s, c) => s + c.open, 0) };
}

// Fatura por mes de vencimento + parcelas futuras (que ainda nao apareceram em nenhum extrato)
export function cardStatus(c: Card, months: Record<string, MonthDoc>, today = todayBR()) {
  const fat: Record<string, number> = {};
  const lastParc = new Map<string, Gasto>();
  const seenParc = new Set<string>();
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (g.card !== c.id || g.tipo === "neutro") continue;
      if (g.parc) seenParc.add(`${descKey(g.desc)}|${g.parc[0]}|${g.parc[1]}`);
      const fm = faturaMonth(c, g.d);
      fat[fm] = (fat[fm] ?? 0) + (g.tipo === "receita" ? -g.v : g.v);
      if (g.parc && g.parc[0] < g.parc[1]) {
        const key = `${descKey(g.desc)}|${g.parc[1]}|${g.v.toFixed(2)}`;
        const prev = lastParc.get(key);
        if (!prev || prev.parc![0] < g.parc[0]) lastParc.set(key, g);
      }
    }
  // Parcelas futuras: da ultima parcela vista ate a ultima, uma por fatura
  const future: Record<string, number> = {};
  for (const g of lastParc.values()) {
    const fm = faturaMonth(c, g.d);
    for (let k = g.parc![0] + 1; k <= g.parc![1]; k++) {
      const m = addMonths(fm, k - g.parc![0]);
      if (!seenParc.has(`${descKey(g.desc)}|${k}|${g.parc![1]}`)) future[m] = (future[m] ?? 0) + g.v;
    }
  }
  const due = (m: string) => dayIn(m, c.dueDay);
  const all = new Set([...Object.keys(fat), ...Object.keys(future)]);
  const faturas = [...all].sort().map((m) => ({ m, due: due(m), v: (fat[m] ?? 0) + (future[m] ?? 0), futuro: future[m] ?? 0 }))
    .filter((f) => f.due >= today && f.v > 0.005);
  const open = faturas.reduce((s, f) => s + f.v, 0);
  return { faturas, open, next: faturas[0] ?? null };
}

