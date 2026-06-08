import { NextResponse } from "next/server";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { loadSeoReportContext } from "@/lib/dt/seo/report-context";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const ctx = await loadSeoReportContext(id);
  if (!ctx) {
    return NextResponse.json({ ok: false, message: "Report not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...ctx });
}
