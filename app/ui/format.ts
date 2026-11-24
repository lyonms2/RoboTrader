// Formatacao de numeros e reais (pt-BR). As telas antigas tem copias locais de fmt/brl; as novas usam estas
export const fmt = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
// "R$ 1.234,56" com espaco que nao quebra entre R$ e o numero
export const brl = (v: number, d = 2) => `${v < -0.004 ? "−" : ""}R$ ${fmt(Math.abs(v), d)}`;
