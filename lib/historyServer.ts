import { adminDb } from "./firebaseAdmin";

// Historicos de um ponto por dia (patrimonio, carteira) agrupados em um documento por mes: {col}_m/{AAAA-MM} = { days: { dia: foto } }.
// O site le ~1 documento por mes em vez de 1 por dia (bem menos leituras no Firebase). O documento do dia continua sendo gravado.
export async function writeDaily(base: string, col: string, day: string, data: Record<string, unknown>) {
  const db = adminDb();
  const clean = JSON.parse(JSON.stringify(data));
  await db.doc(`${base}${col}/${day}`).set(clean);
  const ref = db.doc(`${base}${col}_m/${day.slice(0, 7)}`);
  const cur = ((await ref.get()).data()?.days ?? {}) as Record<string, unknown>;
  await ref.set({ days: { ...cur, [day]: clean } });
  await migrateDaily(base, col);
}

// Uma vez por colecao: junta os dias gravados antes desta versao nos documentos do mes
async function migrateDaily(base: string, col: string) {
  const db = adminDb();
  const flag = db.doc(`${base}config/history`);
  if ((await flag.get()).data()?.[col]) return;
  const snap = await db.collection(`${base}${col}`).get();
  const by: Record<string, Record<string, unknown>> = {};
  for (const d of snap.docs) if (/^\d{4}-\d{2}-\d{2}$/.test(d.id)) (by[d.id.slice(0, 7)] ??= {})[d.id] = d.data();
  for (const [m, days] of Object.entries(by)) {
    const ref = db.doc(`${base}${col}_m/${m}`);
    const cur = ((await ref.get()).data()?.days ?? {}) as Record<string, unknown>;
    await ref.set({ days: { ...days, ...cur } }); // o que ja estava no mes (mais novo) vale
  }
  await flag.set({ [col]: Date.now() }, { merge: true });
}
