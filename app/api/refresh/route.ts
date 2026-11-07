import { NextResponse } from "next/server";
import { serverProjectId } from "@/lib/firebaseAdmin";
import { runJob } from "@/lib/job";
import { requireOwner } from "@/lib/ownerAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Recalcular agora" do painel: exige o token de login do Firebase do e-mail em ALLOWED_EMAIL
export async function POST(req: Request) {
  const denied = await requireOwner(req);
  if (denied) return denied;
  try {
    const out = await runJob({ force: true });
    return NextResponse.json({ ok: true, projectId: serverProjectId(), ...out });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
