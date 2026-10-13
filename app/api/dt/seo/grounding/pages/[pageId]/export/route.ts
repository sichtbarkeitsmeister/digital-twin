import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { DT_GROUNDING_PAGE_SELECT, sortGroundingPages } from "@/lib/dt/seo/grounding-pages";
import { buildGroundingLlmsTxt } from "@/lib/dt/seo/grounding-run/prompts";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtGroundingPageRow } from "@/lib/dt/types";

function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`;
}

function fileSlug(page: DtGroundingPageRow, organisationName: string): string {
  const base = page.kind === "hub" ? `grounding-hub-${organisationName || "organisation"}` : `grounding-${page.slug || page.entity_name || page.id}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `?format=html` downloads the draft page; `?format=llms` the llms.txt of the domain. */
export async function GET(req: Request, context: { params: Promise<{ pageId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const url = new URL(req.url);
  const organisationId = url.searchParams.get("org") ?? "";
  const format = url.searchParams.get("format") ?? "html";
  if (!/^[0-9a-f-]{36}$/i.test(organisationId) || (format !== "html" && format !== "llms")) {
    return NextResponse.json({ ok: false, message: "Ungültige Anfrage." }, { status: 400 });
  }
  const { pageId } = await context.params;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const service = createServiceClient();
  const [{ data: rows, error }, { data: config }] = await Promise.all([
    service.from("dt_grounding_pages").select(DT_GROUNDING_PAGE_SELECT).eq("organisation_id", organisationId),
    service.from("dt_org_config").select("display_name, website_url").eq("organisation_id", organisationId).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  const pages = sortGroundingPages((rows ?? []) as DtGroundingPageRow[]);
  const page = pages.find((p) => p.id === pageId) ?? null;
  if (!page) return NextResponse.json({ ok: false, message: "Grounding Page nicht gefunden." }, { status: 404 });
  const organisationName = ((config?.display_name as string | null | undefined) ?? "").trim();

  if (format === "html") {
    if (!page.html?.trim()) {
      return NextResponse.json({ ok: false, message: "Für diese Seite gibt es noch keine HTML-Datei." }, { status: 404 });
    }
    return new Response(page.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": attachment(`${fileSlug(page, organisationName)}.html`),
        "Cache-Control": "no-store",
      },
    });
  }

  const body = buildGroundingLlmsTxt({
    organisationName: organisationName || "Organisation",
    websiteUrl: ((config?.website_url as string | null | undefined) ?? "").trim() || null,
    pages: pages
      .filter((p) => p.kind === "hub" || p.html?.trim() || p.review_status === "approved")
      .map((p) => ({
        kind: p.kind,
        name: p.kind === "hub" ? p.title || organisationName || "Fakten" : p.title || p.entity_name || p.url,
        url: p.url,
        description: p.meta_description,
      })),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": attachment("llms.txt"),
      "Cache-Control": "no-store",
    },
  });
}
