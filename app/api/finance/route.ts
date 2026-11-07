import { NextResponse } from "next/server";
import { refreshFinance } from "@/lib/finance";
import { requireOwner } from "@/lib/ownerAuth";
import { snapshotNetWorth } from "@/lib/patrimonioServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Financas (acoes/FIIs, CDI, dolar, Tesouro): chamado em paralelo ao "Atualizar tudo" e ao salvar um investimento.
// Fica separado porque o arquivo do Tesouro e grande (~15 MB) e nao pode atrasar os sinais.
export async function POST(req: Request) {
  const denied = await requireOwner(req);
  if (denied) return denied;
  try {
    const res = await refreshFinance({ force: true });
    // Foto do patrimonio do dia (as duas rotas gravam; a ultima a terminar fica com os dados mais novos)
    const patrimonio = await snapshotNetWorth().catch((e) => ({ error: String(e) }));
    return NextResponse.json({ ok: true, ...res, patrimonio });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
