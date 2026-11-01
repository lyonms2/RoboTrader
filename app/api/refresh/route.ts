import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { runJob } from "@/lib/job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Recalcular agora" do painel: exige o token de login do Firebase do e-mail em ALLOWED_EMAIL
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  try {
    const user = await adminAuth().verifyIdToken(token);
    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
    if (!allowed) return NextResponse.json({ error: "ALLOWED_EMAIL nao configurada na Vercel" }, { status: 500 });
    if (user.email?.toLowerCase() !== allowed || !user.email_verified) {
      return NextResponse.json({ error: `o e-mail ${user.email} nao e o ALLOWED_EMAIL` }, { status: 403 });
    }
  } catch (e) {
    // Sem FIREBASE_SERVICE_ACCOUNT valida, o erro aparece aqui (e nao como token invalido)
    const msg = String(e);
    const status = msg.includes("FIREBASE_SERVICE_ACCOUNT") || msg.includes("JSON") || msg.includes("credential") ? 500 : 401;
    return NextResponse.json({ error: status === 500 ? `configuracao do servidor: ${msg}` : `login invalido: ${msg}` }, { status });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runJob({ force: true })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
