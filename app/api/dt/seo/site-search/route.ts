import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import {
  auditSiteIndexabilityForTool,
  inspectWebsiteUrlForTool,
  readSitemapForTool,
} from "@/lib/dt/seo/live-site-tools";
import {
  getDtSitePageContent,
  searchDtSitePages,
} from "@/lib/dt/seo/search-site-pages";
import {
  readIndexStatusForTool,
  triggerGscIndexCheckN8n,
} from "@/lib/dt/seo/url-index-status";

export const maxDuration = 30;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z
    .enum([
      "search",
      "read",
      "sitemap",
      "inspect",
      "audit",
      "index_status",
      "request_index_check",
    ])
    .default("search"),
  query: z.string().trim().min(1).max(400).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  urls: z.array(z.string().trim().min(1).max(2048)).max(30).optional(),
  sitemapUrl: z.string().trim().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

/**
 * On-demand retrieval over crawled website pages for the n8n agent.
 * - action "search": keyword search across all pages → relevant snippets.
 * - action "read": full text of a single page by URL.
 * - action "sitemap": live-read sitemap XML (+ crawl-index sample compare).
 * - action "inspect": live HTTP/meta check for a URL.
 * Token-light by design: callers pull only what they need.
 */
export async function POST(req: Request) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const { organisationId, action, query, url, sitemapUrl, limit } = parsed.data;

  try {
    if (action === "read") {
      if (!url) {
        return NextResponse.json({ ok: false, message: "url erforderlich." }, { status: 400 });
      }
      const page = await getDtSitePageContent(organisationId, url);
      if (!page) {
        return NextResponse.json({ ok: true, found: false, page: null });
      }
      return NextResponse.json({ ok: true, found: true, page });
    }

    if (action === "sitemap") {
      const text = await readSitemapForTool(organisationId, sitemapUrl ?? url ?? null);
      return NextResponse.json({ ok: true, text });
    }

    if (action === "inspect") {
      if (!url) {
        return NextResponse.json({ ok: false, message: "url erforderlich." }, { status: 400 });
      }
      const text = await inspectWebsiteUrlForTool(organisationId, url);
      return NextResponse.json({ ok: true, text });
    }

    if (action === "audit") {
      const text = await auditSiteIndexabilityForTool(organisationId, {
        sitemapUrl: sitemapUrl ?? null,
        urls: parsed.data.urls ?? null,
        limit: limit ?? null,
      });
      return NextResponse.json({ ok: true, text });
    }

    if (action === "index_status") {
      const text = await readIndexStatusForTool(organisationId, {
        url: url ?? null,
        limit: limit ?? undefined,
      });
      return NextResponse.json({ ok: true, text });
    }

    if (action === "request_index_check") {
      const text = await triggerGscIndexCheckN8n({
        organisationId,
        urls: parsed.data.urls,
        limit: limit ?? undefined,
      });
      return NextResponse.json({ ok: true, text });
    }

    if (!query) {
      return NextResponse.json({ ok: false, message: "query erforderlich." }, { status: 400 });
    }
    const hits = await searchDtSitePages(organisationId, query, limit ?? 5);
    return NextResponse.json({ ok: true, count: hits.length, hits });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Suche fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
