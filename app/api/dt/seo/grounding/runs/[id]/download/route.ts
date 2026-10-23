import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { loadRunRow } from "@/lib/dt/seo/grounding-check/store";
import { createServiceClient } from "@/lib/supabase/service";

const FILES = {
  html: { filename: "grounding.html", contentType: "text/html; charset=utf-8", column: "draft_html" },
  llms: { filename: "llms.txt", contentType: "text/plain; charset=utf-8", column: "draft_llms_txt" },
} as const;

/**
 * `?file=html` → grounding.html, `?file=llms` → llms.txt. Only after the human review
 * (approved or uploaded): an unreviewed draft must not reach the website.
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const fileParam = new URL(req.url).searchParams.get("file") ?? "html";
  if (fileParam !== "html" && fileParam !== "llms") {
    return NextResponse.json({ ok: false, message: "Ungültige Datei." }, { status: 400 });
  }
  const { id } = await context.params;
  const run = await loadRunRow(createServiceClient(), id).catch(() => null);
  if (!run) return NextResponse.json({ ok: false, message: "Prüfung nicht gefunden." }, { status: 404 });
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, run.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }
  if (run.status !== "approved" && run.status !== "uploaded") {
    return NextResponse.json({ ok: false, message: "Download erst nach der Freigabe." }, { status: 409 });
  }
  const file = FILES[fileParam];
  const body = run[file.column];
  if (!body?.trim()) return NextResponse.json({ ok: false, message: "Die Datei ist leer." }, { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
