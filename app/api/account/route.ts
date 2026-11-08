import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireUser } from "@/lib/ownerAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// "Apagar meus dados" (so membro): apaga tudo em users/{uid}. O acesso (access/{email}) fica com o dono
export async function DELETE(req: Request) {
  const r = await requireUser(req);
  if ("denied" in r) return r.denied;
  if (r.who.role !== "member") return NextResponse.json({ error: "so para membros" }, { status: 400 });
  try {
    const db = adminDb();
    await db.recursiveDelete(db.doc(`users/${r.who.uid}`));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
