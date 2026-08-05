import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { createServiceClient } from "@/lib/supabase/service";

const resultSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  inspectedAt: z.string().min(1).optional(),
  verdict: z.string().nullable().optional(),
  coverageState: z.string().nullable().optional(),
  indexingState: z.string().nullable().optional(),
  pageFetchState: z.string().nullable().optional(),
  robotsTxtState: z.string().nullable().optional(),
  crawledAs: z.string().nullable().optional(),
  sitemap: z.string().nullable().optional(),
  referringUrls: z.array(z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  results: z.array(resultSchema).min(1).max(50),
});

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return u.toString();
  } catch {
    return url.trim();
  }
}

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

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const rows = parsed.data.results.map((r) => ({
    organisation_id: parsed.data.organisationId,
    url: normalizeUrlKey(r.url),
    inspected_at: r.inspectedAt ?? now,
    verdict: r.verdict ?? null,
    coverage_state: r.coverageState ?? null,
    indexing_state: r.indexingState ?? null,
    page_fetch_state: r.pageFetchState ?? null,
    robots_txt_state: r.robotsTxtState ?? null,
    crawled_as: r.crawledAs ?? null,
    sitemap: r.sitemap ?? null,
    referring_urls: r.referringUrls ?? [],
    raw: r.raw ?? {},
    updated_at: now,
  }));

  const { data, error } = await supabase
    .from("dt_seo_url_index_status")
    .upsert(rows, { onConflict: "organisation_id,url" })
    .select("id,url,inspected_at,verdict,coverage_state,indexing_state");

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: data?.length ?? 0, rows: data ?? [] });
}
