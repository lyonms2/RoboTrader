// Assinatura dos membros: access/{email}.until = fim do dia do vencimento (horario de Brasilia), em ms.
// E so aviso (painel do dono e lembrete do membro): ninguem e bloqueado por ela. Sem until = "sem data".
export const DAY = 86_400_000;
const BR = -3 * 3_600_000; // Brasilia sem horario de verao desde 2019

// AAAA-MM-DD do dia em Brasilia
export const dayBR = (t: number) => new Date(t + BR).toISOString().slice(0, 10);
// fim do dia AAAA-MM-DD em Brasilia
export const endOfDayBR = (ymd: string) => Date.parse(`${ymd}T23:59:59-03:00`);
// DD/MM/AAAA
export const fmtBR = (t: number) => dayBR(t).split("-").reverse().join("/");

// mesmo dia n meses depois (31/01 + 1 mes = 28 ou 29/02)
export function plusMonths(ymd: string, n = 1): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

// "+1 mes": soma a partir do vencimento se ainda estiver em dia, ou a partir de hoje se ja venceu ou nao tem data
export function renew(until: number | null | undefined, now = Date.now()): number {
  const base = typeof until === "number" && until > now ? dayBR(until) : dayBR(now);
  return endOfDayBR(plusMonths(base));
}

// dias de calendario ate o vencimento (0 = vence hoje, negativo = atrasado)
export const daysLeft = (until: number, now = Date.now()) => Math.round((Date.parse(dayBR(until)) - Date.parse(dayBR(now))) / DAY);

export type SubStatus = { s: "atrasado" | "vence" | "ok" | "sem"; dias: number };
export function subStatus(until: unknown, now = Date.now()): SubStatus {
  if (typeof until !== "number") return { s: "sem", dias: 0 };
  const dias = daysLeft(until, now);
  return { s: dias < 0 ? "atrasado" : dias <= 7 ? "vence" : "ok", dias };
}

// texto curto do status, para o painel do dono
export function subLabel(st: SubStatus, until?: number): string {
  if (st.s === "sem" || until === undefined) return "sem data";
  if (st.s === "atrasado") return `atrasado há ${-st.dias} ${-st.dias === 1 ? "dia" : "dias"} (${fmtBR(until)})`;
  if (st.dias === 0) return "vence hoje";
  if (st.s === "vence") return `vence em ${st.dias} ${st.dias === 1 ? "dia" : "dias"} (${fmtBR(until)})`;
  return `em dia até ${fmtBR(until)}`;
}
