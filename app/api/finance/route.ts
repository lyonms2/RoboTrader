import { NextResponse } from "next/server";
import { refreshFinance } from "@/lib/finance";
import { requireUser } from "@/lib/ownerAuth";
import { snapshotNetWorth } from "@/lib/patrimonioServer";
import { markMember } from "@/lib/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Financas (acoes/FIIs, CDI, dolar, Tesouro): chamado em paralelo ao "Atualizar tudo" e ao salvar um investimento.
// Fica separado porque o arquivo do Tesouro e grande (~15 MB) e nao pode atrasar os sinais.
export async function POST(req: Request) {
  const r = await requireUser(req);
  if ("denied" in r) return r.denied;
  const { base } = r.who;
  if (r.who.role === "member") await markMember(base, r.who.email).catch(() => undefined);
  try {
    const res = await refreshFinance({ force: true, base });
    // Foto do patrimonio do dia (as duas rotas gravam; a ultima a terminar fica com os dados mais novos)
    const patrimonio = await snapshotNetWorth(base).catch((e) => ({ error: String(e) }));
    return NextResponse.json({ ok: true, ...res, patrimonio });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
