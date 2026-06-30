import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import {
  getDtSitePageContent,
  searchDtSitePages,
} from "@/lib/dt/seo/search-site-pages";

export const maxDuration = 30;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["search", "read"]).default("search"),
  query: z.string().trim().min(1).max(400).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

/**
 * On-demand retrieval over crawled website pages for the n8n agent.
 * - action "search": keyword search across all pages → relevant snippets.
 * - action "read": full text of a single page by URL.
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

  const { organisationId, action, query, url, limit } = parsed.data;

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
