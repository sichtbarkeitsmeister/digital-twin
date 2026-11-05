import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { draftHtmlWithDesign, loadRunRow } from "@/lib/dt/seo/grounding-check/store";
import { snippetCss } from "@/lib/dt/seo/grounding-design/css";
import { buildCmsSnippet, cmsFieldsFromHtml } from "@/lib/dt/seo/grounding-design/snippet";
import { loadResolvedGroundingDesign } from "@/lib/dt/seo/grounding-design/store";
import { createServiceClient } from "@/lib/supabase/service";

const FILES = {
  html: { filename: "grounding.html", contentType: "text/html; charset=utf-8" },
  snippet: { filename: "grounding-cms-snippet.html", contentType: "text/html; charset=utf-8" },
  llms: { filename: "llms.txt", contentType: "text/plain; charset=utf-8" },
} as const;

/**
 * `?file=html` → grounding.html (full page with the current design), `?file=snippet` → the
 * page content for a CMS (`&css=1` adds the design scoped to .grounding-page),
 * `?file=llms` → llms.txt. Only after the human review (approved or uploaded): an
 * unreviewed draft must not reach the website.
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const fileParam = params.get("file") ?? "html";
  if (fileParam !== "html" && fileParam !== "llms" && fileParam !== "snippet") {
    return NextResponse.json({ ok: false, message: "Ungültige Datei." }, { status: 400 });
  }
  const { id } = await context.params;
  const service = createServiceClient();
  const run = await loadRunRow(service, id).catch(() => null);
  if (!run) return NextResponse.json({ ok: false, message: "Prüfung nicht gefunden." }, { status: 404 });
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, run.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }
  if (run.status !== "approved" && run.status !== "uploaded") {
    return NextResponse.json({ ok: false, message: "Download erst nach der Freigabe." }, { status: 409 });
  }
  const file = FILES[fileParam];
  let body: string | null;
  if (fileParam === "llms") {
    body = run.draft_llms_txt;
  } else {
    const design = await loadResolvedGroundingDesign(service, run.organisation_id);
    const html = draftHtmlWithDesign(run, design);
    body =
      html && fileParam === "snippet"
        ? buildCmsSnippet(html, { css: params.get("css") === "1" ? snippetCss(design, cmsFieldsFromHtml(html).canonicalUrl) : null })
        : html;
  }
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
