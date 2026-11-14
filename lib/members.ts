import { adminDb } from "./firebaseAdmin";
import { refreshFinance } from "./finance";
import { snapshotNetWorth } from "./patrimonioServer";
import { refreshWallet } from "./wallet";

// Membros no agendador: carteira, cotacoes e a foto do patrimonio do dia sem precisar clicar em "Atualizar".
// Em rodizio (quem foi atualizado ha mais tempo primeiro), cada membro no maximo a cada 3 h, e so enquanto houver tempo
// na chamada (o agendador tem 60 s). Marca em users/{uid}/config/auto: email (gravado quando o membro usa o site) e at.
const EVERY_MS = 3 * 3_600_000;

// Chamado nas rotas do membro: guarda o e-mail para o agendador conferir se ele ainda tem acesso
export async function markMember(base: string, email: string) {
  await adminDb().doc(`${base}config/auto`).set({ email, seen: Date.now() }, { merge: true });
}

export async function refreshMembers(deadline: number) {
  const db = adminDb();
  const refs = await db.collection("users").listDocuments();
  const marks = (await Promise.all(refs.map(async (r) => {
    const d = (await db.doc(`users/${r.id}/config/auto`).get()).data() as { email?: string; at?: number } | undefined;
    return { uid: r.id, email: d?.email ?? "", at: d?.at ?? 0 };
  }))).filter((m) => m.email && Date.now() - m.at > EVERY_MS).sort((a, b) => a.at - b.at);
  const done: string[] = [];
  const errors: string[] = [];
  for (const m of marks) {
    if (Date.now() > deadline) break;
    // so quem continua na lista de acesso
    const acc = (await db.doc(`access/${m.email}`).get()).data() as { role?: string } | undefined;
    if (acc?.role !== "member") continue;
    const base = `users/${m.uid}/`;
    for (const [name, fn] of [
      ["carteira", () => refreshWallet({ force: false, base })],
      ["cotacoes", () => refreshFinance({ force: false, base })],
      ["patrimonio", () => snapshotNetWorth(base)],
    ] as const) {
      if (Date.now() > deadline) break;
      try { await fn(); } catch (e) { errors.push(`${m.uid.slice(0, 6)} ${name}: ${String(e).slice(0, 120)}`); }
    }
    await db.doc(`${base}config/auto`).set({ at: Date.now() }, { merge: true });
    done.push(m.uid.slice(0, 6));
  }
  return { membros: refs.length, atualizados: done.length, pendentes: Math.max(0, marks.length - done.length), errors };
}
