import { NextResponse } from "next/server";
import { z } from "zod";

import { loadOrgConfig, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { crawlOrganisationSitePages } from "@/lib/dt/seo/crawl-sitemap";
import { createServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
});

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Eingabe." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const config = await loadOrgConfig(parsed.data.organisationId);
  if (!config) {
    return NextResponse.json({ ok: false, message: "Organisation nicht gefunden." }, { status: 404 });
  }

  const service = createServiceClient();

  try {
    const result = await crawlOrganisationSitePages({
      organisationId: parsed.data.organisationId,
      websiteUrl: config.website_url ?? null,
      sitemapUrl: config.sitemap_url ?? null,
      upsert: async (rows) => {
        for (const row of rows) {
          await service.from("dt_site_pages").upsert(
            {
              organisation_id: parsed.data.organisationId,
              url: row.url,
              title: row.title,
              is_excluded: row.is_excluded,
              crawled_at: new Date().toISOString(),
            },
            { onConflict: "organisation_id,url" },
          );
        }
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Crawl fehlgeschlagen." },
      { status: 500 },
    );
  }
}
