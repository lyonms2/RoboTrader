import { NextResponse } from "next/server";
import { verifyIdToken } from "./verifyIdToken";
import { adminDb } from "./firebaseAdmin";

// Exige o token de login do Firebase do e-mail em ALLOWED_EMAIL. Devolve uma resposta de erro ou null se ok.
export async function requireOwner(req: Request): Promise<NextResponse | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  try {
    const user = await verifyIdToken(token);
    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
    if (!allowed) return NextResponse.json({ error: "ALLOWED_EMAIL nao configurada na Vercel" }, { status: 500 });
    if (user.email?.toLowerCase() !== allowed || !user.email_verified) {
      return NextResponse.json({ error: `o e-mail ${user.email} nao e o ALLOWED_EMAIL` }, { status: 403 });
    }
    return null;
  } catch (e) {
    const msg = String(e);
    const config = msg.includes("nao configurada");
    return NextResponse.json({ error: config ? `configuracao do servidor: ${msg}` : `login invalido: ${msg}` }, { status: config ? 500 : 401 });
  }
}

// Dono (ALLOWED_EMAIL) ou membro (access/{email} com role "member"). base = onde ficam os dados dele
export type Who = { uid: string; email: string; role: "owner" | "member"; base: string };
export async function requireUser(req: Request): Promise<{ who: Who } | { denied: NextResponse }> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  try {
    const user = await verifyIdToken(token);
    const email = (user.email ?? "").toLowerCase();
    if (!email || !user.email_verified) return { denied: NextResponse.json({ error: "e-mail nao verificado" }, { status: 403 }) };
    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
    if (allowed && email === allowed) return { who: { uid: user.uid, email, role: "owner", base: "" } };
    const acc = await adminDb().doc(`access/${email}`).get();
    if (acc.exists && (acc.data() as { role?: string }).role === "member") return { who: { uid: user.uid, email, role: "member", base: `users/${user.uid}/` } };
    return { denied: NextResponse.json({ error: `o e-mail ${email} nao tem acesso` }, { status: 403 }) };
  } catch (e) {
    const msg = String(e);
    const config = msg.includes("nao configurada");
    return { denied: NextResponse.json({ error: config ? `configuracao do servidor: ${msg}` : `login invalido: ${msg}` }, { status: config ? 500 : 401 }) };
  }
}
