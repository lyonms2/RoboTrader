import { NextResponse } from "next/server";
import { refreshFinance } from "@/lib/finance";
import { requireOwner } from "@/lib/ownerAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Financas (acoes/FIIs, CDI, dolar, Tesouro): chamado em paralelo ao "Atualizar tudo" e ao salvar um investimento.
// Fica separado porque o arquivo do Tesouro e grande (~15 MB) e nao pode atrasar os sinais.
export async function POST(req: Request) {
  const denied = await requireOwner(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await refreshFinance({ force: true })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
