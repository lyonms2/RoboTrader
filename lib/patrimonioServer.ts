import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { EMPTY_SETUP, type GastosSetup, type MonthDoc } from "./gastos";
import { netWorth } from "./patrimonio";
import { writeDaily } from "./historyServer";
import type { AppConfig, FinanceDoc, WalletDoc } from "./types";

// Grava a foto do dia em patrimonio_history/{AAAA-MM-DD} (a ultima do dia vale). Chamado pelo "Atualizar tudo" e pelo agendador
export async function snapshotNetWorth(base = "") {
  const db = adminDb();
  const [cfgS, finS, walS, gastosS] = await Promise.all([
    db.doc(`${base}config/main`).get(), db.doc(`${base}finance/main`).get(), db.doc(`${base}wallet/main`).get(),
    db.collection(`${base}config`).where(FieldPath.documentId(), ">=", "gastos-").where(FieldPath.documentId(), "<", "gastos-").get(),
  ]);
  const cfg = cfgS.data() as AppConfig | undefined;
  if (!cfg) return { skipped: true, reason: "sem configuracao" };
  const months: Record<string, MonthDoc> = {};
  let setup: GastosSetup = EMPTY_SETUP;
  for (const d of gastosS.docs) {
    if (d.id === "gastos-setup") setup = { ...EMPTY_SETUP, ...(d.data() as GastosSetup) };
    else months[d.id.slice(7)] = { items: (d.data() as MonthDoc).items ?? [] };
  }
  const nw = netWorth(cfg, (finS.data() as FinanceDoc | undefined) ?? null, (walS.data() as WalletDoc | undefined) ?? null, months, setup);
  if (!(nw.bens > 0) && !(nw.dividas > 0)) return { skipped: true, reason: "nada cadastrado" };
  await writeDaily(base, "patrimonio_history", nw.day, nw);
  return { skipped: false, net: nw.net };
}
