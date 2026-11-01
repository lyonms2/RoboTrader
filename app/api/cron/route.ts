import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runJob } from "@/lib/job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

// Chamado pelo Vercel Cron (1x por dia, vercel.json) e pelo GitHub Actions (a cada 15 min).
// Ambos enviam "Authorization: Bearer <CRON_SECRET>"; a comparacao e em tempo constante.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = req.headers.get("authorization") ?? "";
  if (secret.length < 16 || !timingSafeEqual(digest(got), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runJob({ force: false })) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
