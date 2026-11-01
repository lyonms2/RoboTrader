import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// FIREBASE_SERVICE_ACCOUNT = conteudo do JSON da conta de servico (Firebase > Configuracoes > Contas de servico)
function app() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT nao configurada");
  const sa = JSON.parse(raw);
  sa.private_key = String(sa.private_key).replace(/\\n/g, "\n");
  return initializeApp({ credential: cert(sa) });
}

export const adminDb = () => getFirestore(app());
export const adminAuth = () => getAuth(app());
