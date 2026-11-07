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
export type GastosSetup = {
  cards: Card[]; loans: Loan[]; fixos: Fixo[]; rules: Record<string, string>; categories?: string[];
  ownName?: string; // seu nome como aparece nos extratos: Pix para/de voce mesmo = transferencia entre contas (nao conta)
};
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
  [/aplica[cç][aã]o|resgate|\brdb\b|\bcdb\b|tesouro|caixinha|cofrinho|corretora|invest|dinheiro guardado|dinheiro resgatado|porquinho/, "Investimento"],
  [/sal[aá]rio|folha de pag|proventos? de sal/, "Salario"],
  [/rendimento|juros sobre|dividendo/, "Rendimentos"],
  [/ifood|rappi|restaurante|lanchonete|padaria|burger|mc ?donald|pizza|sushi|churrasc|\bbar\b|cafe|cafeteria|delivery|a[cç]a[ií]|sorvet|lanche|pastel|hamburg|food/, "Alimentacao"],
  [/supermerc|mercado(?! ?(livre|pago))|atacad|assa[ií]|carrefour|p[aã]o de a[cç]|hortifruti|a[cç]ougue|sacol[aã]o|dia %|\bextra\b/, "Mercado"],
  [/uber|\b99 ?(app|pop|taxi)?\b|posto|combust|shell|ipiranga|petrobras|estaciona|sem parar|conectcar|ped[aá]gio|metr[oô]|[oô]nibus|bilhete [uú]nico|recarga bu/, "Transporte"],
  [/aluguel|condom[ií]nio|imobili[aá]ria/, "Moradia"],
  [/enel|cemig|copel|light s|celesc|coelba|energia|sabesp|copasa|sanepar|[aá]gua e esgoto|comg[aá]s|\bg[aá]s\b|vivo|claro|\btim\b|\boi\b|internet|telefon|telecom|fibra/, "Contas (luz, agua, internet)"],
  [/netflix|spotify|prime video|amazon prime|disney|hbo|\bmax\b|globoplay|youtube|apple\.com|icloud|google (one|storage)|chatgpt|openai|deezer|paramount/, "Assinaturas"],
  [/farm[aá]cia|drogaria|droga ?raia|drogasil|pague menos|panvel|hospital|cl[ií]nica|laborat|unimed|amil|hapvida|odonto|m[eé]dic|dentista|psic|academia|smart ?fit|bluefit|crossfit|gym\b/, "Saude"],
  [/amazon|mercado ?livre|mercadolivre|shopee|magalu|magazine luiza|americanas|aliexpress|shein|renner|riachuelo|c&a|centauro|netshoes|kabum|madeira ?madeira|casas bahia|leroy|tok ?stok|temu/, "Compras"],
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
const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
// Transferencia para/de voce mesmo: o nome completo (ou nome + ultimo sobrenome) aparece na descricao
export function isOwn(desc: string, ownName?: string) {
  const n = plain(ownName ?? "");
  if (n.split(" ").length < 2) return false;
  const d = plain(desc);
  const w = n.split(" ");
  return d.includes(n) || d.includes(`${w[0]} ${w[w.length - 1]}`);
}

export function categorize(desc: string, entrada: boolean, rules: Record<string, string>, ownName?: string): { cat: string; tipo: Tipo } {
  if (isOwn(desc, ownName) && /pix|transf|\bted\b|\bdoc\b/i.test(desc)) return { cat: "Transferencia entre contas", tipo: "neutro" };
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
// Valor em qualquer formato de banco: "-45.90", "−R$ 1.000,00" (sinal tipografico), "+R$ 2.915,14", "(12,50)", "12,50-", "12,50 D"
export function toNum(raw: string) {
  let t = raw.trim().replace(/[\u2212\u2013\u2014]/g, "-").replace(/R\$/gi, "").replace(/[\s"'\u00a0]/g, "");
  if (!t) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/[DC]$/i.test(t)) { neg = /D$/i.test(t); t = t.slice(0, -1); }
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("+")) t = t.slice(1);
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d*\.?\d+$/.test(t)) return NaN;
  const v = Number(t);
  return neg ? -v : v;
}
const toIso = (s: string) => {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{2})[/.-](\d{2})[/.-](\d{2,4})/);
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

// CSV de qualquer banco: acha a linha de cabecalho (pode ter texto antes), as colunas de data, valor (ou credito/debito),
// descricao (juntando tipo + origem/destino + historico...) e id. Sem cabecalho, deduz as colunas pelo conteudo.
// Modelos testados: PicPay, Nubank conta e cartao, Inter, Itau, Bradesco, Santander, BB, Caixa, C6, Mercado Pago.
// cardStyle = valores positivos sao compras (fatura de cartao); nesse caso o sinal e invertido.
const normH = (h: string) => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/["']/g, "").replace(/\s+/g, " ").trim();
const isDateH = (h: string) => /^(data|date|dt|dia)\b|data (do |de )?(lancamento|movimento|transacao|compra)|release_date|^data$/.test(h) && !/venc/.test(h);
const isValH = (h: string) => /^valor|amount|^value|quantia|net_amount|^montante|^vlr/.test(h) && !/saldo|balance|original|dolar|usd|cotacao/.test(h);
const isCredH = (h: string) => /^credito|^creditos|^entrada|^entradas|\(\+\)|^receita/.test(h) && !/forma|cartao/.test(h);
const isDebH = (h: string) => /^debito|^debitos|^saida|^saidas|\(-\)|^despesa/.test(h) && !/forma|cartao/.test(h);
const isDescH = (h: string) => /^tipo$|tipo de (transacao|lancamento|movimento)|transaction_type|^lancamento|historico|descri|title|titulo|estabelecimento|origem|destino|favorecido|beneficiario|contraparte|^memo|detalhe|^nome|identificacao/.test(h)
  && !/forma de pagamento|categoria|^data|valor|saldo/.test(h);
const isIdH = (h: string) => /identificador|^id$|fitid|reference_id|^documento|docto|n.? ?(do )?documento|^codigo da transacao/.test(h);
const isTimeH = (h: string) => /^hora|^time|horario/.test(h);
const SKIP = /^saldo\b|saldo (anterior|do dia|final|disponivel|em conta|inicial)|^s ?a ?l ?d ?o|^total\b|^lancamentos futuros/i;

function bestSep(line: string) {
  return [";", ",", "\t", "|"].map((c) => [c, splitCsv(line, c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCSV(text: string): { rows: Raw[]; cardStyle: boolean; error?: string; info?: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let hi = -1;
  let sep = ",";
  let head: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (!lines[i].trim()) continue;
    const sp = bestSep(lines[i]);
    const h = splitCsv(lines[i], sp).map(normH);
    if (h.some(isDateH) && h.some((x) => isValH(x) || isCredH(x) || isDebH(x))) { hi = i; sep = sp; head = h; break; }
  }
  type Cols = { d: number; v: number; c: number; db: number; desc: number[]; id: number; time: number };
  let cols: Cols;
  let body: string[];
  if (hi >= 0) {
    const find = (f: (h: string) => boolean) => head.findIndex(f);
    cols = {
      d: find(isDateH), v: find(isValH), c: find(isCredH), db: find(isDebH),
      desc: head.map((h, i) => (isDescH(h) ? i : -1)).filter((i) => i >= 0), id: find(isIdH), time: find(isTimeH),
    };
    body = lines.slice(hi + 1);
  } else {
    // Sem cabecalho: coluna com data, coluna com numero (a ultima que parece valor) e o texto mais longo como descricao
    const data = lines.filter((l) => l.trim()).slice(0, 50);
    if (!data.length) return { rows: [], cardStyle: false, error: "arquivo vazio" };
    sep = bestSep(data[0]);
    const grid = data.map((l) => splitCsv(l, sep));
    const n = Math.max(...grid.map((r) => r.length));
    const share = (f: (x: string) => boolean, i: number) => grid.filter((r) => r[i] !== undefined && f(r[i])).length / grid.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    const d = idx.find((i) => share((x) => !!toIso(x), i) > 0.6) ?? -1;
    const nums = idx.filter((i) => i !== d && share((x) => Number.isFinite(toNum(x)) && /\d[.,]\d{2}\b/.test(x), i) > 0.6);
    const descs = idx.filter((i) => i !== d && !nums.includes(i) && share((x) => /[a-z]{3}/i.test(x), i) > 0.5);
    if (d < 0 || !nums.length || !descs.length)
      return { rows: [], cardStyle: false, error: "nao reconheci o formato (faltou achar as colunas de data, valor e descricao)" };
    // Com mais de uma coluna numerica, a ultima costuma ser o saldo: usa a primeira
    cols = { d, v: nums[0], c: -1, db: -1, desc: descs, id: -1, time: -1 };
    body = data;
  }
  if (cols.d < 0 || (cols.v < 0 && cols.c < 0 && cols.db < 0))
    return { rows: [], cardStyle: false, error: "nao encontrei as colunas de data e valor" };

  const rows: Raw[] = [];
  const seen: Record<string, number> = {};
  for (const l of body) {
    if (!l.trim()) continue;
    const c = splitCsv(l, sep);
    const d = toIso(c[cols.d] ?? "");
    if (!d) continue;
    let amount: number;
    if (cols.v >= 0) amount = toNum(c[cols.v] ?? "");
    else {
      const cr = cols.c >= 0 ? toNum(c[cols.c] ?? "") : NaN;
      const db = cols.db >= 0 ? toNum(c[cols.db] ?? "") : NaN;
      amount = (Number.isFinite(cr) ? Math.abs(cr) : 0) - (Number.isFinite(db) ? Math.abs(db) : 0);
      if (!Number.isFinite(cr) && !Number.isFinite(db)) amount = NaN;
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    const parts = cols.desc.map((i) => (c[i] ?? "").trim()).filter(Boolean);
    const desc = [...new Set(parts)].join(" - ") || "(sem descricao)";
    if (SKIP.test(desc)) continue;
    const id = cols.id >= 0 ? (c[cols.id] ?? "").trim() : "";
    const time = cols.time >= 0 ? (c[cols.time] ?? "").trim() : "";
    const base = id.length >= 8 ? id : `${d}${time ? ` ${time}` : ""}|${desc}|${amount}${id ? `|${id}` : ""}`;
    seen[base] = (seen[base] ?? 0) + 1; // mesma compra duas vezes no mesmo dia
    rows.push({ d, desc, amount, ext: seen[base] > 1 ? `${base}#${seen[base]}` : base });
  }
  if (!rows.length) return { rows: [], cardStyle: false, error: "nenhum lancamento com data e valor encontrado" };
  const label = (i: number) => (hi >= 0 ? head[i] : `coluna ${i + 1}`);
  const info = `colunas: ${label(cols.d)}, ${cols.desc.map(label).join(" + ")}, ${cols.v >= 0 ? label(cols.v) : [cols.c, cols.db].filter((i) => i >= 0).map(label).join(" / ")}`;
  const isCardHead = hi >= 0 && head.includes("title");
  const cardStyle = isCardHead || (cols.v >= 0 && rows.filter((r) => r.amount > 0).length > rows.length * 0.7);
  return { rows: cardStyle ? rows.map((r) => ({ ...r, amount: -r.amount })) : rows, cardStyle, info };
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

