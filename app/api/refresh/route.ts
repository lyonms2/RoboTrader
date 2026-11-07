import { NextResponse } from "next/server";
import { refreshCandidates } from "@/lib/candidates";
import { refreshFichas } from "@/lib/fichas";
import { snapshotNetWorth } from "@/lib/patrimonioServer";
import { serverProjectId } from "@/lib/firebaseAdmin";
import { runJob } from "@/lib/job";
import { requireOwner } from "@/lib/ownerAuth";
import { SYMBOLS } from "@/lib/types";
import { refreshWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botao "Atualizar tudo" do painel: carteiras -> sinais (com a Lighter) -> fichas, nessa ordem, porque os sinais usam
// o saldo das carteiras e as fichas usam os sinais. Exige o login do e-mail em ALLOWED_EMAIL.
export async function POST(req: Request) {
  const denied = await requireOwner(req);
  if (denied) return denied;
  const step = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      return { error: String(e) };
    }
  };
  try {
    const wallet = await step(() => refreshWallet({ force: true }));
    const job = await runJob({ force: true, fichas: false });
    const fichas = await step(() => refreshFichas({ force: true, strategy: SYMBOLS.map((s) => s.replace("USDT", "")) }));
    // Outras moedas: so se a avaliacao tiver mais de 1 semana
    const candidates = await step(() => refreshCandidates({ force: false }));
    const patrimonio = await step(() => snapshotNetWorth());
    return NextResponse.json({ ok: true, projectId: serverProjectId(), ...job, wallet, fichas, candidates, patrimonio });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
