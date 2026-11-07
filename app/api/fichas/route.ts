import { NextResponse } from "next/server";
import { refreshFichas } from "@/lib/fichas";
import { requireOwner } from "@/lib/ownerAuth";
import { SYMBOLS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Atualizar fichas": monta de novo as fichas dos tokens na hora
export async function POST(req: Request) {
  const denied = await requireOwner(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await refreshFichas({ force: true, strategy: SYMBOLS.map((s) => s.replace("USDT", "")) })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
