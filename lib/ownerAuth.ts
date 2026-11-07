import { NextResponse } from "next/server";
import { verifyIdToken } from "./verifyIdToken";

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
