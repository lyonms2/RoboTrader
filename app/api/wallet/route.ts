import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/ownerAuth";
import { refreshWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Atualizar carteira": le de novo a carteira on-chain na hora
export async function POST(req: Request) {
  const denied = await requireOwner(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await refreshWallet({ force: true })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
