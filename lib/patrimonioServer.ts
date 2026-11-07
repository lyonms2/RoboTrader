import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";
import { EMPTY_SETUP, type GastosSetup, type MonthDoc } from "./gastos";
import { netWorth } from "./patrimonio";
import type { AppConfig, FinanceDoc, WalletDoc } from "./types";

// Grava a foto do dia em patrimonio_history/{AAAA-MM-DD} (a ultima do dia vale). Chamado pelo "Atualizar tudo" e pelo agendador
export async function snapshotNetWorth() {
  const db = adminDb();
  const [cfgS, finS, walS, gastosS] = await Promise.all([
    db.doc("config/main").get(), db.doc("finance/main").get(), db.doc("wallet/main").get(),
    db.collection("config").where(FieldPath.documentId(), ">=", "gastos-").where(FieldPath.documentId(), "<", "gastos-").get(),
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
  await db.doc(`patrimonio_history/${nw.day}`).set(JSON.parse(JSON.stringify(nw)));
  return { skipped: false, net: nw.net };
}
