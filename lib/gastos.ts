import type { FinItem } from "./types";

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
  io?: "in" | "out"; // entrou ou saiu da conta (importante nos neutros: guardar no cofrinho sai, resgatar entra)
  inv?: string; // id do investimento (aba Investimentos) para onde foi / de onde veio o dinheiro
  acc?: string; // conta (PicPay, Nubank...) por onde passou; sem cartao e sem conta = a primeira conta
  payCard?: string; // pagamento de fatura feito pela conta: qual cartao foi pago
  toAcc?: string; // transferencia entre contas: a outra conta (para onde foi / de onde veio). Um lancamento move as duas
  by?: string; // pago por outra pessoa (id da conta com ela em "A receber"): e seu gasto, mas nao saiu da sua conta; abate o que ela te deve
};
// Conta bancaria: saldo conferido numa data (ancora). O saldo em qualquer outro dia sai dos lancamentos
export type Account = {
  id: string; name: string; balance?: number; at?: string;
  // Conta sem extrato (ex.: conta da esposa usada para pagar contas): comeca do zero, recebe as transferencias e
  // os gastos lancados nela saem do saldo. O que sobra e o "a discriminar"
  noStatement?: boolean;
};
export type MonthDoc = { items: Gasto[] };
export type Card = {
  id: string; name: string; closeDay: number; dueDay: number; limit?: number; budget?: number; // budget = planejado por fatura
  // Pagamentos feitos pelo botao "pagar": fatura (mes de vencimento), data, valor e o lancamento criado na conta
  pays?: { id: string; fm: string; d: string; v: number; gid?: string; gm?: string }[];
};
// A receber: alguem te deve e paga em parcelas (voce emprestou, ou vendeu/prestou servico parcelado)
export type Recv = {
  id: string; name: string; // quem deve (o nome ajuda a achar o Pix no extrato)
  kind: "emprestei" | "venda" | "conta"; // emprestei: receber nao e renda; venda: cada parcela e renda; conta: saldo que sobe e desce
  saldo0?: number; since?: string; // conta: quanto ela te devia (negativo = voce devia a ela) no dia "since" (AAAA-MM-DD)
  adj?: { id: string; d: string; v: number; desc: string }[]; // conta: ajustes a mao (+ ela deve mais, - ela pagou em dinheiro)
  parcela: number; n: number; first: string; dueDay: number; // R$ por parcela, quantas, AAAA-MM da 1a, dia combinado
  gotBefore?: number; // parcelas ja recebidas antes de cadastrar (as primeiras)
  gets?: { k: number; d: string; v: number; gid?: string; gm?: string }[]; // marcadas no botao "recebi"
  keys?: string[]; // descricoes do extrato ja ligadas (aprende quando voce liga um lancamento)
  notIds?: string[]; // lancamentos que voce disse "nao e este"
  note?: string;
};

export type Loan = {
  id: string; name: string;
  parcela: number; // R$ por mes
  n: number; // total de parcelas
  first: string; // AAAA-MM da 1a parcela
  dueDay: number;
  rate?: number; // juros % ao mes (opcional: deixa o saldo devedor mais certo)
  // Parcelas adiantadas (quitadas antes, as ultimas do contrato): data, quantas e quanto pagou
  // from: "fim" = as ultimas do contrato (termina antes); "AAAA-MM" = as parcelas a partir desse mes (pula esses meses)
  prepay?: { id: string; d: string; n: number; v: number; from?: string }[];
  // Parcelas pagas marcadas por voce (botao "pagar"): indice k (0..n-1), data, valor e o lancamento criado na conta
  pays?: { k: number; d: string; v: number; gid?: string; gm?: string }[];
  // Parcelas ja pagas quando o emprestimo foi cadastrado (as primeiras). Sem o campo: nenhuma
  paidBefore?: number;
};
export type Fixo = {
  id: string; desc: string; v: number; cat: string; dia: number; card?: string;
  steps?: { from: string; v: number }[]; // valor muda a partir de um mes (AAAA-MM): reajuste do aluguel etc. v = valor antes do 1o
  varia?: boolean; // valor diferente todo mes (luz, agua): a previsao e a media dos ultimos pagamentos
  reaj?: number; // mes do reajuste anual (1-12): avisa para atualizar o valor
  keys?: string[]; // descricoes do extrato ja ligadas a este fixo (aprende quando voce liga um lancamento)
  start?: string; end?: string; // AAAA-MM: primeiro e ultimo mes do gasto (sem start = desde sempre; sem end = sem fim)
  notIds?: string[]; // lancamentos que voce disse "nao e este" (nao contam como pagamento deste fixo)
};
// O fixo existe neste mes?
export const fixoActive = (f: Fixo, m: string) => (!f.start || m >= f.start) && (!f.end || m <= f.end);
export type GastosSetup = {
  cards: Card[]; loans: Loan[]; fixos: Fixo[]; rules: Record<string, string>; categories?: string[];
  customCats?: CustomCat[]; // categorias criadas por voce (ex.: Presentes, Pet)
  ownName?: string; // seu nome como aparece nos extratos: Pix para/de voce mesmo = transferencia entre contas (nao conta)
  account?: { balance: number; at: string } | null; // (antigo) um saldo so; agora vale "accounts"
  accounts?: Account[];
  invRules?: Record<string, string>; // descricao -> investimento escolhido (lembrado para as proximas)
  accRules?: Record<string, string>; // descricao -> conta de destino de transferencias
  recvs?: Recv[]; // a receber (alguem te deve em parcelas)
};
export const EMPTY_SETUP: GastosSetup = { cards: [], loans: [], fixos: [], rules: {} };

export const CATS_GASTO = [
  "Moradia", "Mercado", "Alimentacao", "Transporte", "Saude", "Assinaturas", "Contas (luz, agua, internet)", "Compras",
  "Educacao", "Lazer e viagem", "Pix e transferencias", "Emprestimos", "Impostos e tarifas", "Outros",
];
export const CATS_RECEITA = ["Salario", "Renda extra", "Rendimentos", "Pix recebido", "Outras entradas"];
// Neutros: o dinheiro so muda de lugar (nao e gasto nem renda). A conta sobe/desce, mas o patrimonio nao muda
export const CATS_NEUTRO = ["Fatura do cartao", "Investimento", "Compra de cripto", "Venda de cripto", "Transferencia entre contas", "Emprestimo recebido",
  "Emprestei dinheiro", "Devolucao de emprestimo"];
export const RECV_OUT_CAT = "Emprestei dinheiro"; // saiu da conta para alguem que vai te pagar (vira "a receber")
export const RECV_BACK_CAT = "Devolucao de emprestimo"; // parcela de quem te deve entrando (nao e renda)
export const RECV_SALE_CAT = "Renda extra"; // parcela de venda/servico (e renda)
export const CARD_PAY_CAT = "Fatura do cartao";
export const TRANSFER_CAT = "Transferencia entre contas";
// Categorias suas (gasto ou entrada). Ficam num registro do modulo, atualizado quando o setup carrega
export type CustomCat = { name: string; tipo: "gasto" | "receita" };
let CUSTOM: CustomCat[] = [];
export const setCustomCats = (c?: CustomCat[]) => { CUSTOM = c ?? []; };
export const customCats = () => CUSTOM;
// "Outros" e "Outras entradas" sozinhos nao dizem nada: o site pede para discriminar
export const GENERIC_CATS = ["Outros", "Outras entradas"];
export const tipoOfCat = (c: string): Tipo | null =>
  CATS_NEUTRO.includes(c) ? "neutro" : CATS_RECEITA.includes(c) ? "receita" : CATS_GASTO.includes(c) ? "gasto"
    : CUSTOM.find((x) => x.name === c)?.tipo ?? null;

// Palavras-chave comuns em extratos brasileiros -> categoria (a primeira que bater)
const KEYWORDS: [RegExp, string][] = [
  [/pagamento (de )?fatura|pagamento recebido|pgto fatura|fatura cart/, "Fatura do cartao"],
  [/binance|mercado ?bitcoin|bitso|foxbit|novadax|bitpre[cç]o|coinext|transak|moonpay|banxa|ramp network|coinbase|kraken|\bokx\b|bybit|kucoin|ripio|\bbipa\b|paxos|alchemy pay|onramp|cripto|crypto|bitcoin|\busdt\b|\busdc\b/, "Compra de cripto"],
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
export const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
// Transferencia para/de voce mesmo: o nome completo (ou nome + ultimo sobrenome) aparece na descricao
export function isOwn(desc: string, ownName?: string) {
  const n = plain(ownName ?? "");
  if (n.split(" ").length < 2) return false;
  const d = plain(desc);
  const w = n.split(" ");
  return d.includes(n) || d.includes(`${w[0]} ${w[w.length - 1]}`);
}

export function categorize(desc: string, entrada: boolean, rules: Record<string, string>, ownName?: string): { cat: string; tipo: Tipo } {
  // 1) o que voce ja escolheu para essa descricao vale primeiro (ex.: Pix para voce mesmo = pagar o emprestimo)
  const learned = rules[descKey(desc)];
  // ("Outros"/"Outras entradas" aprendido nao vale: nao diz nada e esconderia a regra certa, ex.: resgate do cofrinho)
  if (learned && tipoOfCat(learned) && !GENERIC_CATS.includes(learned)) return { cat: learned, tipo: tipoOfCat(learned)! };
  if (isOwn(desc, ownName) && /pix|transf|\bted\b|\bdoc\b/i.test(desc)) return { cat: "Transferencia entre contas", tipo: "neutro" };
  const low = desc.toLowerCase();
  for (const [re, cat] of KEYWORDS) {
    if (!re.test(low)) continue;
    const t = tipoOfCat(cat)!;
    // Dinheiro voltando da cripto = venda; credito de emprestimo na conta = emprestimo recebido (vira divida, nao renda)
    if (cat === "Compra de cripto") return { cat: entrada ? "Venda de cripto" : cat, tipo: "neutro" };
    if (cat === "Emprestimos" && entrada) return { cat: "Emprestimo recebido", tipo: "neutro" };
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
// Quais parcelas (indice 0..n-1) cada adiantamento cobre: as ultimas ("fim") ou a partir de um mes
export function prepaidSlots(l: Loan, today?: string) {
  const taken = new Map<number, string>(); // indice -> id do adiantamento
  const list = [...(l.prepay ?? [])].filter((p) => !today || p.d <= today).sort((a, b) => a.d.localeCompare(b.d));
  for (const p of list) {
    let left = p.n;
    if (!p.from || p.from === "fim") {
      for (let k = l.n - 1; k >= 0 && left > 0; k--) if (!taken.has(k)) { taken.set(k, p.id); left--; }
    } else {
      for (let k = Math.max(0, monthDiff(l.first, p.from)); k < l.n && left > 0; k++) if (!taken.has(k)) { taken.set(k, p.id); left--; }
      for (let k = l.n - 1; k >= 0 && left > 0; k--) if (!taken.has(k)) { taken.set(k, p.id); left--; } // sobrou: tira do fim
    }
  }
  return taken;
}
export const prepaidUntil = (l: Loan, today = todayBR()) => prepaidSlots(l, today).size;

export const loanDue = (l: Loan, k: number) => dayIn(addMonths(l.first, k), l.dueDay);
// Tudo comeca em aberto: voce decide parcela por parcela (pagar / marcar como paga) ou o extrato mostra o pagamento
export const paidBeforeOf = (l: Loan) => Math.max(0, Math.min(l.n, l.paidBefore ?? 0));
export type LoanRow = {
  k: number; m: string; due: string;
  status: "paga" | "adiantada" | "atrasada" | "aberta"; // aberta = ainda nao venceu
  via?: "antes" | "voce" | "extrato" | "adiantada"; d?: string; v?: number;
};
// Cronograma do emprestimo, parcela por parcela. Paga = marcada por voce, ja paga no cadastro, adiantada,
// ou achada no extrato do mes do vencimento (lancamento ligado ao emprestimo ou em Emprestimos com o mesmo valor)
export function loanRows(l: Loan, today = todayBR(), ctx?: { months: Record<string, MonthDoc>; setup: GastosSetup }): LoanRow[] {
  const pre = prepaidSlots(l, today);
  const before = paidBeforeOf(l);
  const pays = new Map((l.pays ?? []).map((p) => [p.k, p]));
  const rows: LoanRow[] = [];
  for (let k = 0; k < l.n; k++) {
    const m = addMonths(l.first, k), due = loanDue(l, k);
    const p = pays.get(k);
    if (p) rows.push({ k, m, due, status: "paga", via: "voce", d: p.d, v: p.v });
    else if (pre.has(k)) rows.push({ k, m, due, status: "adiantada", via: "adiantada" });
    else if (k < before) rows.push({ k, m, due, status: "paga", via: "antes" });
    else if (ctx && ctx.months[m]?.items.length && !pendingFor(m, ctx.months[m].items, ctx.setup).some((x) => x.ref === l.id))
      rows.push({ k, m, due, status: "paga", via: "extrato" });
    else rows.push({ k, m, due, status: due < today ? "atrasada" : "aberta" });
  }
  return rows;
}

export function loanStatus(l: Loan, today = todayBR(), ctx?: { months: Record<string, MonthDoc>; setup: GastosSetup }) {
  const rows = loanRows(l, today, ctx);
  const all = prepaidSlots(l);
  const pre = rows.filter((r) => r.status === "adiantada").length;
  const paid = rows.filter((r) => r.status === "paga" || r.status === "adiantada").length;
  const late = rows.filter((r) => r.status === "atrasada");
  const left = l.n - paid;
  const r = (l.rate ?? 0) / 100;
  const saldo = r > 0 ? (l.parcela * (1 - (1 + r) ** -left)) / r : l.parcela * left;
  const prepaidV = (l.prepay ?? []).filter((p) => p.d <= today).reduce((s, p) => s + p.v, 0);
  // termina na ultima parcela que ainda falta pagar (pagar as ultimas antes encurta o emprestimo)
  let lastK = -1;
  for (const x of rows) if (x.status === "atrasada" || x.status === "aberta") lastK = x.k;
  if (lastK < 0) for (let k = 0; k < l.n; k++) if (!all.has(k)) lastK = k;
  const nextRow = rows.find((x) => x.status === "atrasada" || x.status === "aberta");
  return {
    rows, paid, left, saldo, prepaid: pre, late: late.length, lateV: late.length * l.parcela,
    saved: Math.max(0, pre * l.parcela - prepaidV), // desconto por adiantar
    end: addMonths(l.first, Math.max(0, lastK)), originalEnd: addMonths(l.first, l.n - 1),
    next: nextRow ? nextRow.due : null, nextK: nextRow ? nextRow.k : null,
  };
}
// Parcela do emprestimo que vence no mes m (null se fora do prazo)
export function loanInstallment(l: Loan, m: string) {
  const k = monthDiff(l.first, m);
  return k >= 0 && k < l.n && !prepaidSlots(l).has(k) && !(l.pays ?? []).some((p) => p.k === k) && k >= paidBeforeOf(l) ? k + 1 : null;
}
export const monthDiff = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// ---------- resumo ----------
export type MonthSummary = {
  gastos: number; receitas: number; byCat: Record<string, number>;
  forOthers?: number; // compras no cartao para outras pessoas descontadas da fatura deste mes
};
// Mes pelo extrato da conta: compras no cartao ficam de fora (o controle delas e em Cartoes e emprestimos) e o
// pagamento da fatura conta como uma saida, no dia em que sai da conta
// Cartoes cadastrados (registro do modulo, atualizado quando o setup carrega): para saber em que fatura cai cada compra
let CARDS: Card[] = [];
export const setCardsReg = (c?: Card[]) => { CARDS = c ?? []; };
// Compras no cartao feitas para outra pessoa (categoria "Emprestei dinheiro") cujas faturas vencem no mes m:
// a fatura paga conta inteira como gasto, entao essa parte e descontada no mesmo mes
export function cardForOthers(months: Record<string, MonthDoc>, m: string) {
  let v = 0;
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (!g.card || g.cat !== RECV_OUT_CAT || dirOf(g) > 0) continue;
      const c = CARDS.find((x) => x.id === g.card);
      if (c && faturaMonth(c, g.d) === m) v += g.v;
    }
  return v;
}
export function summarize(items: Gasto[], ctx?: { m: string; months: Record<string, MonthDoc> }): MonthSummary {
  const s: MonthSummary = { gastos: 0, receitas: 0, byCat: {} };
  for (const i of items) {
    if (i.card) continue;
    if (i.tipo === "gasto" || (i.cat === CARD_PAY_CAT && dirOf(i) < 0)) { s.gastos += i.v; s.byCat[i.cat] = (s.byCat[i.cat] ?? 0) + i.v; }
    else if (i.tipo === "receita") s.receitas += i.v;
  }
  if (ctx) {
    const o = cardForOthers(ctx.months, ctx.m);
    if (o > 0) { s.gastos = Math.max(0, s.gastos - o); s.byCat[CARD_PAY_CAT] = Math.max(0, (s.byCat[CARD_PAY_CAT] ?? 0) - o); s.forOthers = o; }
  }
  return s;
}

// Compras de uma fatura (cartao c, fatura que vence no mes fm), em qualquer mes de lancamento
export function faturaItems(c: Card, months: Record<string, MonthDoc>, fm: string) {
  const out: { m: string; g: Gasto }[] = [];
  for (const [m, md] of Object.entries(months))
    for (const g of md.items) if (g.card === c.id && !isCardCredit(g) && faturaMonth(c, g.d) === fm) out.push({ m, g });
  return out.sort((a, b) => b.g.d.localeCompare(a.g.d));
}

// Compromissos dos proximos meses: faturas (com parcelas futuras, sem o que ja foi pago) e parcelas de emprestimo
export function commitments(months: Record<string, MonthDoc>, setup: GastosSetup, n = 12) {
  const start = monthOf(todayBR());
  const st = setup.cards.map((c) => cardStatus(c, months));
  return Array.from({ length: n }, (_, k) => {
    const m = addMonths(start, k);
    const cards = st.reduce((s, x) => s + (x.all.find((f) => f.m === m)?.rest ?? 0), 0);
    const loans = setup.loans.reduce((s, l) => s + (loanInstallment(l, m) ? l.parcela : 0), 0);
    return { m, cards, loans };
  });
}
// Media de gastos dos ultimos 3 meses fechados que tem lancamentos (usada na reserva de emergencia)
export function avgMonthly(months: Record<string, MonthDoc>, current = monthOf(todayBR())) {
  // so meses com saidas da conta (compras no cartao sozinhas nao contam: elas entram quando a fatura e paga)
  const keys = Object.keys(months).filter((m) => m < current && summarize(months[m].items, { m, months }).gastos > 0).sort().slice(-3);
  if (!keys.length) return null;
  return { value: keys.reduce((s, m) => s + summarize(months[m].items, { m, months }).gastos, 0) / keys.length, months: keys.length };
}

// Valor do fixo num mes (considera os reajustes)
export function fixoValue(f: Fixo, m: string) {
  let v = f.v;
  for (const s of [...(f.steps ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (s.from <= m) v = s.v;
  return v;
}
// Lancamento que paga o fixo: ligado a ele, ou com descricao ja aprendida
const fixoLinked = (f: Fixo, i: Gasto) => i.ref === f.id || (!i.ref && (f.keys ?? []).includes(descKey(i.desc)));
// Ultimos pagamentos do fixo antes do mes m (ate 3, olhando 6 meses para tras)
export function fixoHistory(f: Fixo, m: string, months: Record<string, MonthDoc>) {
  const out: { m: string; v: number }[] = [];
  for (let k = 1; k <= 6 && out.length < 3; k++) {
    const mm = addMonths(m, -k);
    const hit = (months[mm]?.items ?? []).find((i) => i.tipo === "gasto" && fixoLinked(f, i));
    if (hit) out.push({ m: mm, v: hit.v });
  }
  return out;
}
// Quanto se espera pagar no mes: o valor do periodo, ou (valor que varia) a media dos ultimos pagamentos
export function fixoExpected(f: Fixo, m: string, months?: Record<string, MonthDoc>) {
  const base = fixoValue(f, m);
  if (!f.varia || !months) return base;
  const h = fixoHistory(f, m, months);
  return h.length ? Math.round((h.reduce((s, x) => s + x.v, 0) / h.length) * 100) / 100 : base;
}
// Mes de reajuste e o valor ainda nao foi atualizado neste ano
export const fixoReajPending = (f: Fixo, m: string) =>
  !!f.reaj && Number(m.slice(5, 7)) === f.reaj && !(f.steps ?? []).some((s) => s.from.slice(0, 4) === m.slice(0, 4));

// Contas do mes: cada fixo e parcela de emprestimo, com o lancamento que pagou (ou nenhum).
// Pago quando ha: 1) lancamento ligado a ele; 2) descricao ja aprendida ou com o nome do fixo (ex.: "CELESC" no extrato);
// 3) valor que varia: mesma categoria + nome parecido; 4) mesmo valor (2%) na mesma categoria; 5) mesmo valor em qualquer
// categoria (aluguel por Pix cai em "Pix e transferencias"). O "como" aparece na tela, com "nao e este" para desfazer.
export type BillHow = "ligado" | "nome" | "valor-cat" | "valor";
export type Bill = {
  ref: string; desc: string; v: number; cat: string; d: string; card?: string; parc?: [number, number]; varia?: boolean; reaj?: boolean;
  fixo?: boolean; paid?: Gasto; how?: BillHow;
};
const nameWords = (s: string) => plain(s).split(" ").filter((w) => w.length > 3 && !/^(conta|pagamento|parcela|boleto)$/.test(w));
export function monthBills(m: string, items: Gasto[], setup: GastosSetup, months?: Record<string, MonthDoc>): Bill[] {
  const used = new Set<string>();
  const match = (ref: string, v: number, cat: string, k?: number, opt: { name?: (i: Gasto) => boolean; not?: string[] } = {}): [Gasto, BillHow] | null => {
    // lancamento ligado a outra parcela (ex.: parcela atrasada paga neste mes) nao conta para esta
    const free = items.filter((i) => !used.has(i.id) && i.tipo === "gasto" && !(i.ref && i.ref !== ref) && !(k && i.ref === ref && i.parc && i.parc[0] !== k)
      && !(opt.not ?? []).includes(i.id));
    const tries: [Gasto | undefined, BillHow][] = [
      [free.find((i) => i.ref === ref), "ligado"],
      [opt.name ? free.find((i) => !i.ref && opt.name!(i)) : undefined, "nome"],
      [free.find((i) => !i.ref && i.cat === cat && Math.abs(i.v - v) <= v * 0.02), "valor-cat"],
      [k ? undefined : free.find((i) => !i.ref && Math.abs(i.v - v) <= v * 0.02), "valor"],
    ];
    const hit = tries.find(([g]) => g);
    if (!hit) return null;
    used.add(hit[0]!.id);
    return [hit[0]!, hit[1]];
  };
  const out: Bill[] = [];
  for (const f of setup.fixos) {
    if (!fixoActive(f, m)) continue;
    const v = fixoExpected(f, m, months);
    const words = nameWords(f.desc);
    // pelo nome: descricao aprendida, ou o nome do fixo no texto do extrato; valor que varia aceita ate 50% de diferenca
    const name = (i: Gasto) => fixoLinked(f, i)
      || (words.length > 0 && words.some((w) => plain(i.desc).includes(w)) && Math.abs(i.v - v) <= v * (f.varia ? 0.5 : 0.1));
    const r = match(f.id, v, f.cat, undefined, { name, not: f.notIds });
    out.push({ ref: f.id, desc: f.desc, v, cat: f.cat, d: dayIn(m, f.dia), card: f.card, varia: f.varia, reaj: fixoReajPending(f, m), fixo: true,
      ...(r ? { paid: r[0], how: r[1] } : {}) });
  }
  for (const l of setup.loans) {
    const k = loanInstallment(l, m);
    if (!k) continue;
    const r = match(l.id, l.parcela, "Emprestimos", k);
    out.push({ ref: l.id, desc: `${l.name} (parcela ${k}/${l.n})`, v: l.parcela, cat: "Emprestimos", d: dayIn(m, l.dueDay), parc: [k, l.n],
      ...(r ? { paid: r[0], how: r[1] } : {}) });
  }
  return out;
}
// Previstos do mes que ainda nao foram pagos
export function pendingFor(m: string, items: Gasto[], setup: GastosSetup, months?: Record<string, MonthDoc>) {
  return monthBills(m, items, setup, months).filter((b) => !b.paid);
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
const isSaldoH = (h: string) => /^saldo|balance/.test(h) && !/anterior|inicial/.test(h);
const SKIP = /^saldo\b|saldo (anterior|do dia|final|disponivel|em conta|inicial)|^s ?a ?l ?d ?o|^total\b|^lancamentos futuros/i;

function bestSep(line: string) {
  return [";", ",", "\t", "|"].map((c) => [c, splitCsv(line, c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCSV(text: string): { rows: Raw[]; cardStyle: boolean; error?: string; info?: string; balance?: { v: number; d: string } } {
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
  type Cols = { d: number; v: number; c: number; db: number; desc: number[]; id: number; time: number; bal?: number };
  let cols: Cols;
  let body: string[];
  if (hi >= 0) {
    const find = (f: (h: string) => boolean) => head.findIndex(f);
    cols = {
      d: find(isDateH), v: find(isValH), c: find(isCredH), db: find(isDebH),
      desc: head.map((h, i) => (isDescH(h) ? i : -1)).filter((i) => i >= 0), id: find(isIdH), time: find(isTimeH), bal: find(isSaldoH),
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
  const bals: { d: string; v: number; i: number }[] = []; // saldo depois de cada linha (quando o banco informa)
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
    if (cols.bal !== undefined && cols.bal >= 0) {
      const b = toNum(c[cols.bal] ?? "");
      if (Number.isFinite(b) && (c[cols.bal] ?? "").trim()) bals.push({ d, v: b, i: bals.length });
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
  // Saldo final: o da data mais recente; no mesmo dia, o ultimo na ordem do arquivo (ou o primeiro, se o arquivo vem do mais novo)
  let balance: { v: number; d: string } | undefined;
  if (bals.length && !cardStyle) {
    const desc = bals[0].d > bals[bals.length - 1].d;
    const maxD = bals.reduce((m, b) => (b.d > m ? b.d : m), "");
    const same = bals.filter((b) => b.d === maxD);
    const pick = desc ? same[0] : same[same.length - 1];
    balance = { v: pick.v, d: pick.d };
  }
  return { rows: cardStyle ? rows.map((r) => ({ ...r, amount: -r.amount })) : rows, cardStyle, info, ...(balance ? { balance } : {}) };
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
  const loans = setup.loans.reduce((s, l) => s + loanStatus(l, today, { months, setup }).saldo, 0);
  const cards = setup.cards.map((c) => cardStatus(c, months, today));
  // recv = o que te devem (entra no patrimonio como bem; nao abate o que voce deve)
  const rs = (setup.recvs ?? []).map((r) => recvStatus(r, months, today));
  const recv = rs.reduce((s, x) => s + x.leftV, 0);
  const people = rs.reduce((s, x) => s + x.owe, 0); // conta com a pessoa negativa: voce deve a ela
  const cardsOpen = cards.reduce((s, c) => s + c.open, 0);
  return { loans, cards: cardsOpen, total: loans + cardsOpen + people, recv, people };
}

// ---------- a receber ----------
export const recvDue = (r: Recv, k: number) => dayIn(addMonths(r.first, k), r.dueDay);
export type RecvRow = { k: number; due: string; m: string; status: "recebida" | "atrasada" | "aberta"; via?: "antes" | "voce" | "extrato"; d?: string; v?: number; g?: Gasto };
// Lancamento do extrato que parece pagamento desta divida: ligado a ela, descricao aprendida, ou o nome da pessoa no texto (valor ate 10% longe)
export function recvMatches(r: Recv, g: Gasto) {
  if (r.kind === "conta") return false;
  if (g.card || dirOf(g) < 0 || g.tipo === "gasto" || (r.notIds ?? []).includes(g.id)) return false;
  if (g.ref) return g.ref === r.id;
  if ((r.keys ?? []).includes(descKey(g.desc))) return true;
  const words = plain(r.name).split(" ").filter((w) => w.length > 2 && !/^(de|da|do|dos|das)$/.test(w));
  const d = plain(g.desc);
  return words.length > 0 && words.every((w) => d.includes(w)) && Math.abs(g.v - r.parcela) <= r.parcela * 0.1;
}
// Conta com a pessoa: tudo que mexe no saldo, em ordem de data (v > 0 = ela passa a dever mais)
export type LedgerEntry = { id: string; d: string; desc: string; v: number; kind: "inicio" | "ajuste" | "porela" | "pagou" | "pagouconta"; g?: Gasto; auto?: boolean; bal: number };
const personWords = (name: string) => plain(name).split(" ").filter((w) => w.length > 2 && !/^(de|da|do|dos|das)$/.test(w));
export function recvLedger(r: Recv, months: Record<string, MonthDoc>) {
  const since = r.since ?? "0000-00-00";
  const words = personWords(r.name);
  const out: Omit<LedgerEntry, "bal">[] = [{ id: "inicio", d: since, desc: "saldo inicial", v: r.saldo0 ?? 0, kind: "inicio" }];
  for (const a of r.adj ?? []) out.push({ id: a.id, d: a.d, desc: a.desc, v: a.v, kind: "ajuste" });
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (g.d <= since && !(g.ref === r.id || g.by === r.id)) continue;
      if ((r.notIds ?? []).includes(g.id)) continue;
      if (g.by === r.id) { out.push({ id: g.id, d: g.d, desc: g.desc, v: -g.v, kind: "pagouconta", g }); continue; }
      const dir = dirOf(g);
      if (g.ref === r.id) { out.push({ id: g.id, d: g.d, desc: g.desc, v: dir < 0 ? g.v : -g.v, kind: dir < 0 ? "porela" : "pagou", g }); continue; }
      // Pix dela que entrou (nome no extrato, qualquer valor)
      if (!g.ref && !g.card && dir > 0 && g.tipo !== "gasto" && words.length && (words.every((w) => plain(g.desc).includes(w)) || (r.keys ?? []).includes(descKey(g.desc))))
        out.push({ id: g.id, d: g.d, desc: g.desc, v: -g.v, kind: "pagou", g, auto: true });
    }
  out.sort((a, b) => (a.kind === "inicio" ? -1 : b.kind === "inicio" ? 1 : a.d.localeCompare(b.d)));
  let bal = 0;
  return out.map((e) => ({ ...e, bal: (bal = Math.round((bal + e.v) * 100) / 100) }));
}

export function recvStatus(r: Recv, months: Record<string, MonthDoc>, today = todayBR()) {
  if (r.kind === "conta") {
    const led = recvLedger(r, months);
    const saldo = led.length ? led[led.length - 1].bal : 0;
    return { rows: [] as RecvRow[], got: 0, gotV: 0, left: 0, leftV: Math.max(0, saldo), late: 0, lateV: 0, next: null as string | null, nextK: null as number | null,
      end: r.first, saldo, owe: Math.max(0, -saldo) };
  }
  const rows: RecvRow[] = Array.from({ length: r.n }, (_, k) => ({ k, due: recvDue(r, k), m: addMonths(r.first, k), status: "aberta" as const }));
  const gb = r.gotBefore ?? 0;
  for (const row of rows) if (row.k < gb) Object.assign(row, { status: "recebida", via: "antes" });
  const gets = r.gets ?? [];
  for (const x of gets) { const row = rows[x.k]; if (row && row.status !== "recebida") Object.assign(row, { status: "recebida", via: "voce", d: x.d, v: x.v }); }
  const gids = new Set(gets.map((x) => x.gid).filter(Boolean));
  // "recebi" sem lancar entrada: o mesmo valor que vier no extrato perto da data e esse recebimento (nao conta duas vezes)
  const marked = gets.filter((x) => !x.gid);
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 5 * 86_400_000;
  const cands: Gasto[] = [];
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (gids.has(g.id) || !recvMatches(r, g)) continue;
      const mi = marked.findIndex((x) => Math.abs(x.v - g.v) <= 0.01 * g.v + 0.01 && near(x.d, g.d));
      if (mi >= 0) { marked.splice(mi, 1); continue; }
      cands.push(g);
    }
  cands.sort((a, b) => a.d.localeCompare(b.d));
  // ligado a uma parcela certa primeiro; o resto vai para a parcela em aberto mais antiga
  const rest: Gasto[] = [];
  for (const g of cands) {
    const row = g.ref === r.id && g.parc ? rows[g.parc[0] - 1] : undefined;
    if (row && row.status !== "recebida") Object.assign(row, { status: "recebida", via: "extrato", d: g.d, v: g.v, g });
    else rest.push(g);
  }
  for (const g of rest) {
    const row = rows.find((x) => x.status !== "recebida");
    if (!row) break;
    Object.assign(row, { status: "recebida", via: "extrato", d: g.d, v: g.v, g });
  }
  for (const row of rows) if (row.status !== "recebida" && row.due < today) row.status = "atrasada";
  const open = rows.filter((x) => x.status !== "recebida");
  const late = rows.filter((x) => x.status === "atrasada");
  const gotRows = rows.filter((x) => x.status === "recebida");
  return {
    rows, got: gotRows.length, gotV: gotRows.reduce((t, x) => t + (x.v ?? r.parcela), 0),
    left: open.length, leftV: open.length * r.parcela, late: late.length, lateV: late.length * r.parcela,
    next: open[0]?.due ?? null, nextK: open[0]?.k ?? null, end: rows[rows.length - 1]?.m ?? r.first, saldo: open.length * r.parcela, owe: 0,
  };
}
// Parcelas a receber com vencimento no mes m (para o "Contas do mes")
export function monthReceipts(m: string, months: Record<string, MonthDoc>, setup: GastosSetup, today = todayBR()) {
  const out: { r: Recv; row: RecvRow }[] = [];
  for (const r of setup.recvs ?? []) for (const row of recvStatus(r, months, today).rows) if (row.m === m) out.push({ r, row });
  return out.sort((a, b) => a.row.due.localeCompare(b.row.due));
}
// Recebimento achado no extrato mas com a categoria errada (Pix recebido = renda) ou sem ligacao: o conserto
export function recvFixes(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const out: { m: string; id: string; patch: Partial<Gasto>; who: string }[] = [];
  for (const r of setup.recvs ?? []) {
    if (r.kind === "conta") {
      for (const e of recvLedger(r, months))
        if (e.auto && e.g) out.push({ m: monthOf(e.g.d), id: e.g.id, patch: { cat: RECV_BACK_CAT, tipo: "neutro", io: "in", ref: r.id }, who: r.name });
      continue;
    }
    for (const row of recvStatus(r, months).rows) {
      const g = row.g;
      if (!g) continue;
      const want: Partial<Gasto> = r.kind === "emprestei" ? { cat: RECV_BACK_CAT, tipo: "neutro", io: "in" } : { cat: g.tipo === "receita" ? g.cat : RECV_SALE_CAT, tipo: "receita" };
      const ok = g.ref === r.id && g.parc?.[0] === row.k + 1 && g.cat === want.cat && g.tipo === want.tipo;
      if (!ok) out.push({ m: monthOf(g.d), id: g.id, patch: { ...want, ref: r.id, parc: [row.k + 1, r.n] }, who: r.name });
    }
  }
  return out;
}

// Fatura por mes de vencimento + parcelas futuras (que ainda nao apareceram em nenhum extrato)
// Data em que fecha a fatura que vence no mes fm
export function closeDateOf(c: Card, fm: string) {
  return dayIn(c.dueDay > c.closeDay ? fm : addMonths(fm, -1), c.closeDay);
}

// Credito na propria fatura (pagamento recebido / estorno importado da fatura): neutro que ENTROU.
// Compra no cartao com categoria neutra (cripto, investimento...) continua sendo compra.
export const isCardCredit = (g: Gasto) => !!g.card && g.tipo === "neutro" && (g.io ? g.io === "in" : dirOf(g) === 1);

// Pagamentos de um cartao: pela conta (lancamento com payCard) ou pela propria fatura ("Pagamento recebido" com card).
// O mesmo pagamento visto dos dois lados (mesmo valor, ate 5 dias) conta uma vez so.
function cardPayments(c: Card, months: Record<string, MonthDoc>) {
  const mine = new Set((c.pays ?? []).map((p) => p.gid).filter(Boolean));
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  // "pagar" sem lancar saida (o pagamento vem pelo extrato): o lancamento do extrato com o mesmo valor e o mesmo pagamento
  const marked = (c.pays ?? []).filter((p) => !p.gid);
  const list: { d: string; v: number }[] = [];
  for (const md of Object.values(months))
    for (const g of md.items) {
      const isPay = (g.payCard === c.id && !g.card) || (g.card === c.id && isCardCredit(g));
      if (!isPay || mine.has(g.id)) continue;
      if (marked.some((p) => Math.abs(p.v - g.v) < 0.01 && days(p.d, g.d) <= 5)) continue;
      if (list.some((x) => Math.abs(x.v - g.v) < 0.01 && days(x.d, g.d) <= 5)) continue;
      list.push({ d: g.d, v: g.v });
    }
  return list.sort((a, b) => a.d.localeCompare(b.d));
}

// Faturas do cartao: compras por mes de vencimento + parcelas futuras - pagamentos.
// Cada pagamento abate a fatura fechada mais recente ainda em aberto (pagar antes do vencimento ja tira da divida).
// Pagamento sem nenhuma fatura acompanhada fechada antes dele e de uma fatura antiga (antes de voce importar): ignorado.
export function cardStatus(c: Card, months: Record<string, MonthDoc>, today = todayBR()) {
  const fat: Record<string, number> = {};
  const lastParc = new Map<string, Gasto>();
  const seenParc = new Set<string>();
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (g.card !== c.id || isCardCredit(g)) continue;
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
  const all = [...new Set([...Object.keys(fat), ...Object.keys(future)])].sort();
  const list = all.map((m) => ({ m, close: closeDateOf(c, m), due: dayIn(m, c.dueDay), v: (fat[m] ?? 0) + (future[m] ?? 0), futuro: future[m] ?? 0, paid: 0 }));
  // primeiro os pagamentos do botao "pagar", na fatura escolhida (o que sobrar abate as outras em aberto)
  const extra: { d: string; v: number }[] = [];
  for (const p of c.pays ?? []) {
    const f = list.find((x) => x.m === p.fm);
    const take = f ? Math.min(p.v, Math.max(0, f.v - f.paid)) : 0;
    if (f) f.paid += take;
    if (p.v - take > 0.005) extra.push({ d: p.d, v: p.v - take });
  }
  for (const p of [...cardPayments(c, months), ...extra]) {
    let left = p.v;
    // da fatura fechada mais recente para a mais antiga
    for (const f of [...list].reverse()) {
      if (left <= 0.005) break;
      if (f.close > p.d) continue;
      const take = Math.min(left, f.v - f.paid);
      if (take > 0.005) { f.paid += take; left -= take; }
    }
  }
  const faturas = list.map((f) => ({ ...f, rest: Math.max(0, f.v - f.paid), status: f.v - f.paid <= 0.5 ? "paga" as const : f.due < today ? "vencida" as const : f.close <= today ? "fechada" as const : "aberta" as const }))
    .filter((f) => f.v > 0.005);
  const pend = faturas.filter((f) => f.status !== "paga");
  const open = pend.reduce((s, f) => s + f.rest, 0);
  const overdue = pend.filter((f) => f.status === "vencida");
  return { faturas: pend.map((f) => ({ ...f, v: f.rest })), all: faturas, open, next: pend.find((f) => f.status !== "vencida") ?? null, overdue };
}


// ---------- saldo em conta ----------
// Direcao do lancamento na conta: +1 entrou, -1 saiu (lancamentos antigos sem "io": pelo tipo e pela descricao)
export function dirOf(g: Gasto): 1 | -1 {
  if (g.io) return g.io === "in" ? 1 : -1;
  if (g.tipo === "receita") return 1;
  if (g.tipo === "gasto") return -1;
  return /resgat|recebid|estorno|devolu|reembols/i.test(g.desc) ? 1 : -1;
}

// Contas cadastradas; sem nenhuma, uma "Conta principal" (com o saldo antigo, se havia)
export function accountsOf(setup: GastosSetup): Account[] {
  if (setup.accounts?.length) return setup.accounts;
  return [{ id: "main", name: "Conta principal", ...(setup.account ? { balance: setup.account.balance, at: setup.account.at } : {}) }];
}
export const accIdOf = (g: Gasto, accounts: Account[]) =>
  g.card || g.by ? null : g.acc && accounts.some((a) => a.id === g.acc) ? g.acc : accounts[0].id;

// Saldo da conta no fim do dia "date". Com saldo conferido (B no dia A): para frente B + movimentos depois de A,
// para tras B - movimentos entre a data e A. Sem saldo conferido: soma dos movimentos desde o primeiro (comeca do zero).
// Conta tudo que passa pela conta: gastos, entradas, cofrinho, pagamento de fatura. Compras no cartao ficam de fora.
export function balanceAt(months: Record<string, MonthDoc>, accounts: Account[], accId: string, date: string) {
  const acc = accounts.find((a) => a.id === accId)!;
  const anchored = acc.balance !== undefined && !!acc.at;
  let v = anchored ? acc.balance! : 0;
  for (const md of Object.values(months))
    for (const g of md.items) {
      // na conta do lancamento: o sentido dele; na conta de destino da transferencia: o contrario
      const f = accIdOf(g, accounts) === accId ? dirOf(g) * g.v : g.toAcc === accId && !g.card ? -dirOf(g) * g.v : null;
      if (f === null) continue;
      if (anchored) {
        if (g.d > acc.at! && g.d <= date) v += f;
        else if (g.d > date && g.d <= acc.at!) v -= f;
      } else if (g.d <= date) v += f;
    }
  return v;
}

// Movimentos de uma conta entre dois dias (para conferir o saldo linha a linha): + entrou, - saiu
export function accountMoves(months: Record<string, MonthDoc>, accounts: Account[], accId: string, from: string, to: string) {
  const out: { g: Gasto; v: number; via: "propria" | "transferencia" }[] = [];
  for (const md of Object.values(months))
    for (const g of md.items) {
      if (g.d <= from || g.d > to) continue;
      if (accIdOf(g, accounts) === accId) out.push({ g, v: dirOf(g) * g.v, via: "propria" });
      else if (g.toAcc === accId && !g.card) out.push({ g, v: -dirOf(g) * g.v, via: "transferencia" });
    }
  return out.sort((a, b) => a.g.d.localeCompare(b.g.d));
}

// Situacao das contas no mes m: saldo no inicio (fim do mes anterior), no fim do mes (ou hoje) e agora
export function accountsStatus(months: Record<string, MonthDoc>, setup: GastosSetup, m = monthOf(todayBR())) {
  const accounts = accountsOf(setup);
  const today = todayBR();
  const endOfMonth = `${m}-31`;
  const end = endOfMonth < today ? endOfMonth : today;
  const startDay = `${addMonths(m, -1)}-31`;
  const used = new Set<string>();
  let first = "";
  for (const md of Object.values(months))
    for (const g of md.items) {
      const id = accIdOf(g, accounts);
      if (!id) continue;
      used.add(id);
      if (g.toAcc) used.add(g.toAcc);
      if (!first || g.d < first) first = g.d;
    }
  const rows = accounts.map((a) => ({
    acc: a, informed: (a.balance !== undefined && !!a.at) || !!a.noStatement, used: used.has(a.id),
    start: balanceAt(months, accounts, a.id, startDay), end: balanceAt(months, accounts, a.id, end), now: balanceAt(months, accounts, a.id, today),
  }));
  const sum = (k: "start" | "end" | "now") => rows.reduce((s, r) => s + r[k], 0);
  return { rows, start: sum("start"), end: sum("end"), now: sum("now"), allInformed: rows.every((r) => r.informed || !r.used), first, endDay: end };
}

// Total em conta hoje (vai para o patrimonio como "Conta corrente")
export function accountBalance(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const st = accountsStatus(months, setup);
  if (!st.rows.some((r) => r.informed || r.used)) return null;
  return { value: st.now, informed: st.allInformed, since: st.first, count: st.rows.length };
}

// ---------- banco e saldo tirados do arquivo ----------
const BANK_CODES: Record<string, string> = {
  "380": "PicPay", "260": "Nubank", "077": "Inter", "77": "Inter", "341": "Itau", "237": "Bradesco", "001": "Banco do Brasil", "1": "Banco do Brasil",
  "104": "Caixa", "033": "Santander", "33": "Santander", "336": "C6 Bank", "323": "Mercado Pago", "290": "PagBank", "212": "Banco Original",
  "756": "Sicoob", "748": "Sicredi", "655": "Neon", "403": "Cora", "197": "Stone", "208": "BTG", "102": "XP",
};
const BANK_NAMES = ["PicPay", "Nubank", "Inter", "Itau", "Bradesco", "Santander", "Caixa", "C6", "Mercado Pago", "PagBank", "Neon", "Sicoob", "Sicredi", "BTG", "XP", "Banco do Brasil"];
export function guessBank(text: string, fileName = "") {
  const ofxId = text.match(/<BANKID>\s*0*(\d+)/i)?.[1];
  if (ofxId && BANK_CODES[ofxId]) return BANK_CODES[ofxId];
  const org = text.match(/<ORG>([^<\r\n]+)/i)?.[1]?.trim();
  const hay = plain(`${fileName} ${org ?? ""}`);
  const byName = BANK_NAMES.find((b) => hay.includes(plain(b)) || (b === "Banco do Brasil" && /\bbb\b/.test(hay)));
  if (byName) return byName;
  const head = plain(text.slice(0, 400));
  if (head.includes("origem / destino")) return "PicPay";
  if (head.includes("identificador") && head.includes("descri")) return "Nubank";
  if (/^date,title,amount/.test(head)) return "Nubank";
  if (head.includes("release_date")) return "Mercado Pago";
  if (head.includes("titulo") && head.includes("entrada(r$)")) return "C6";
  if (head.includes("extrato conta corrente") && head.includes("data lancamento")) return "Inter";
  return null;
}
// Saldo final do extrato OFX (LEDGERBAL)
export function ofxBalance(text: string) {
  const b = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>\s*([-\d.,]+)[\s\S]*?<DTASOF>\s*(\d{8})/i);
  if (!b) return null;
  const v = Number(b[1].replace(",", "."));
  const d = toIso(b[2]);
  return Number.isFinite(v) && d ? { v, d } : null;
}

// ---------- ligacao com os investimentos ----------
export const INVEST_CAT = "Investimento";
// So da para ligar a cofrinho/conta (saldo + CDI) e "outro" (valor a mao): Tesouro e acoes dependem de quantidade
export const linkable = (items: FinItem[]) => items.filter((i) => i.kind === "caixa" || i.kind === "outro");

// Movimentos ligados a cada investimento: + quando saiu da conta para ele (guardou), - quando voltou (resgatou)
export function investFlows(months: Record<string, MonthDoc>) {
  const out: Record<string, { d: string; v: number }[]> = {};
  for (const md of Object.values(months))
    for (const g of md.items) if (g.inv) (out[g.inv] ??= []).push({ d: g.d, v: -dirOf(g) * g.v });
  return out;
}

const STOP = new Set(["do", "da", "de", "dos", "das", "no", "na", "meu", "minha", "banco", "conta", "para"]);
// Destino sugerido: 1) o que voce ja escolheu para essa descricao, 2) nome do investimento na descricao,
// 3) se so existe um cofrinho e a descricao fala de guardar/resgatar, ele
export function suggestInv(desc: string, items: FinItem[], rules?: Record<string, string>) {
  const list = linkable(items);
  if (!list.length) return undefined;
  const learned = rules?.[descKey(desc)];
  if (learned && list.some((i) => i.id === learned)) return learned;
  const d = plain(desc);
  let best: string | undefined;
  let bestScore = 0;
  for (const i of list) {
    const words = plain(i.name).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
    const hits = words.filter((w) => d.includes(w)).length;
    const score = hits + (hits && hits === words.length ? 1 : 0);
    if (hits && score > bestScore) { best = i.id; bestScore = score; }
  }
  if (best) return best;
  const boxes = list.filter((i) => i.kind === "caixa");
  if (boxes.length === 1 && /cofrinho|caixinha|porquinho|guardad|resgat|\brdb\b|\bcdb\b|aplica/.test(d)) return boxes[0].id;
  return undefined;
}

// Nome para um cofrinho novo a partir do extrato: "No cofrinho Cofrinho do Cartao" -> "Cofrinho do Cartao"
export function invNameFromDesc(desc: string) {
  const m = desc.match(/(cofrinho|caixinha|porquinho|poupan[cç]a|cdb|rdb)[^-|]*$/i);
  if (!m) return "Cofrinho";
  const parts = m[0].trim().split(/\s+/);
  // "cofrinho Cofrinho do Cartao": pula a palavra repetida
  const start = parts.length > 1 && parts[0].toLowerCase() === parts[1].toLowerCase() ? 1 : 0;
  const name = parts.slice(start).join(" ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Dia anterior (AAAA-MM-DD)
export const prevDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

// Qual cartao um pagamento de fatura pagou: o unico cartao; o nome do cartao na descricao; ou o valor de uma fatura em aberto
export function suggestCard(desc: string, v: number, cards: Card[], months: Record<string, MonthDoc>) {
  if (!cards.length) return undefined;
  if (cards.length === 1) return cards[0].id;
  const d = plain(desc);
  const byName = cards.find((c) => plain(c.name).split(" ").some((w) => w.length > 2 && d.includes(w)));
  if (byName) return byName.id;
  const byValue = cards.find((c) => cardStatus(c, months).all.some((f) => Math.abs(f.v - v) <= Math.max(1, f.v * 0.01)));
  return byValue?.id;
}

// Pix entre suas contas: sem o outro lado (entrada em outra conta cadastrada, mesmo valor, ate 3 dias) o dinheiro
// sai de uma conta e nao entra em nenhuma
export function unmatchedTransfers(months: Record<string, MonthDoc>, setup: GastosSetup) {
  const accounts = accountsOf(setup);
  // com conta de destino escolhida, o lancamento ja move as duas contas
  const all = Object.values(months).flatMap((md) => md.items).filter((g) => g.cat === TRANSFER_CAT && !g.card && !(g.toAcc && accounts.some((a) => a.id === g.toAcc)));
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  const used = new Set<string>();
  const out: Gasto[] = [];
  for (const g of all) {
    if (used.has(g.id)) continue;
    const other = all.find((x) => x.id !== g.id && !used.has(x.id) && dirOf(x) === -dirOf(g) && Math.abs(x.v - g.v) < 0.01 && days(x.d, g.d) <= 3
      && accIdOf(x, accounts) !== accIdOf(g, accounts));
    if (other) { used.add(g.id); used.add(other.id); } else out.push(g);
  }
  return out;
}

// Ja lancado? mesmo valor, ate 3 dias de diferenca, lancado a mao ou por "marcar pago" (sem id de extrato)
export function looksDuplicate(d: string, v: number, items: Gasto[]) {
  return items.some((g) => !g.ext && Math.abs(g.v - v) < 0.005 && Math.abs(Date.parse(g.d) - Date.parse(d)) <= 3 * 86_400_000);
}

// Conta de destino de uma transferencia: a ja escolhida para essa descricao, ou a conta cujo nome aparece no texto
export function suggestToAcc(desc: string, fromAcc: string | null, setup: GastosSetup) {
  const accounts = accountsOf(setup).filter((a) => a.id !== fromAcc);
  const learned = setup.accRules?.[descKey(desc)];
  if (learned && accounts.some((a) => a.id === learned)) return learned;
  const d = plain(desc);
  return accounts.find((a) => plain(a.name).split(" ").some((w) => w.length > 2 && d.includes(w)))?.id;
}
// Nome para a conta nova: a pessoa depois do " - " ("Pix enviado - Daiane Franco de Oliveira" -> "Daiane")
export function accNameFromDesc(desc: string) {
  const who = desc.split(" - ").slice(1).join(" - ").trim() || desc;
  const first = who.split(/\s+/)[0] ?? "Conta";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
