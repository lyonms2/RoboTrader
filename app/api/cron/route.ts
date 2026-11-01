import { NextResponse } from "next/server";
import { runJob } from "@/lib/job";

export const dynamic = "force-dynamic";

// Chamado pelo Vercel Cron (vercel.json). A Vercel envia "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, results: await runJob({ notify: true }) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
