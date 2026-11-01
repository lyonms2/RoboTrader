import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { runJob } from "@/lib/job";

export const dynamic = "force-dynamic";

// Botao "Recalcular agora" do painel: exige o token de login do Firebase do e-mail em ALLOWED_EMAIL
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  try {
    const user = await adminAuth().verifyIdToken(token);
    const allowed = (process.env.ALLOWED_EMAIL ?? "").toLowerCase();
    if (!allowed || user.email?.toLowerCase() !== allowed || !user.email_verified) {
      return NextResponse.json({ error: "nao autorizado" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, results: await runJob({ notify: false }) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
