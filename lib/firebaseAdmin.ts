import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// FIREBASE_SERVICE_ACCOUNT = conteudo do JSON da conta de servico (Firebase > Configuracoes > Contas de servico)
function app() {
  if (getApps().length) return getApps()[0];
  let raw = (process.env.FIREBASE_SERVICE_ACCOUNT ?? "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT nao configurada");
  // Aceita o JSON colado com aspas em volta ou em base64
  if (raw.startsWith("'") || raw.startsWith('"')) raw = raw.slice(1, -1);
  if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT nao e um JSON valido (cole o arquivo da conta de servico inteiro)");
  }
  sa.private_key = String(sa.private_key).replace(/\\n/g, "\n");
  return initializeApp({ credential: cert(sa) });
}

export const adminDb = () => getFirestore(app());
