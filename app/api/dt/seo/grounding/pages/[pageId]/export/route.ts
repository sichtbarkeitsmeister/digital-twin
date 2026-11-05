import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { DT_GROUNDING_PAGE_SELECT, sortGroundingPages } from "@/lib/dt/seo/grounding-pages";
import { injectDesign, snippetCss } from "@/lib/dt/seo/grounding-design/css";
import { buildCmsSnippet, cmsFieldsFromHtml } from "@/lib/dt/seo/grounding-design/snippet";
import { loadResolvedGroundingDesign } from "@/lib/dt/seo/grounding-design/store";
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

/** Shown inline (preview iframe): sandboxed even when opened directly, nothing but inline CSS and fonts. */
const PREVIEW_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; font-src https:";

/**
 * `?format=html` downloads the draft page with the current design (`&preview=1` shows it
 * inline for the preview), `?format=snippet` the page content for a CMS (`&css=1` adds the
 * design scoped to .grounding-page), `?format=llms` the llms.txt of the domain.
 */
export async function GET(req: Request, context: { params: Promise<{ pageId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const url = new URL(req.url);
  const organisationId = url.searchParams.get("org") ?? "";
  const format = url.searchParams.get("format") ?? "html";
  if (!/^[0-9a-f-]{36}$/i.test(organisationId) || (format !== "html" && format !== "llms" && format !== "snippet")) {
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

  if (format === "html" || format === "snippet") {
    if (!page.html?.trim()) {
      return NextResponse.json({ ok: false, message: "Für diese Seite gibt es noch keine HTML-Datei." }, { status: 404 });
    }
    // The agent's HTML never brings its own styles: the current design goes in here.
    const design = await loadResolvedGroundingDesign(service, organisationId);
    const html = injectDesign(page.html, design);
    if (format === "snippet") {
      const body = buildCmsSnippet(html, { css: url.searchParams.get("css") === "1" ? snippetCss(design, cmsFieldsFromHtml(html).canonicalUrl ?? page.url) : null });
      return new Response(body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": attachment(`${fileSlug(page, organisationName)}-cms-snippet.html`),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const preview = url.searchParams.get("preview") === "1";
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": preview ? "inline" : attachment(`${fileSlug(page, organisationName)}.html`),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(preview ? { "Content-Security-Policy": PREVIEW_CSP } : {}),
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
