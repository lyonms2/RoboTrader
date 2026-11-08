import { NextResponse } from "next/server";
import { requireUser } from "@/lib/ownerAuth";
import { refreshWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Atualizar carteira": le de novo a carteira on-chain na hora
export async function POST(req: Request) {
  const r = await requireUser(req);
  if ("denied" in r) return r.denied;
  const { who } = r;
  try {
    return NextResponse.json({ ok: true, ...(await refreshWallet({ force: who.role === "owner", base: who.base })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
