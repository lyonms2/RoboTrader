import { NextResponse } from "next/server";
import { runJob } from "@/lib/job";
import { verifyIdToken } from "@/lib/verifyIdToken";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Recalcular agora" do painel: exige o token de login do Firebase do e-mail em ALLOWED_EMAIL
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  try {
    const user = await verifyIdToken(token);
    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
    if (!allowed) return NextResponse.json({ error: "ALLOWED_EMAIL nao configurada na Vercel" }, { status: 500 });
    if (user.email?.toLowerCase() !== allowed || !user.email_verified) {
      return NextResponse.json({ error: `o e-mail ${user.email} nao e o ALLOWED_EMAIL` }, { status: 403 });
    }
  } catch (e) {
    const msg = String(e);
    const config = msg.includes("nao configurada");
    return NextResponse.json({ error: config ? `configuracao do servidor: ${msg}` : `login invalido: ${msg}` }, { status: config ? 500 : 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runJob({ force: true })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
