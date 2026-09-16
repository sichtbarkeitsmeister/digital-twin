import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { resolveOrigin } from "@/lib/dt/seo/crawl-sitemap";
import { derivePageIndexStatus, type CrawlIndexFilter } from "@/lib/dt/seo/gsc-pages";
import { loadCrawlViewerSnapshot } from "@/lib/dt/seo/load-crawl-viewer";
import { startOrganisationSiteCrawl } from "@/lib/dt/seo/start-org-crawl";
import { syncCrawlJobHealth } from "@/lib/dt/seo/sync-crawl-job-health";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 60;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
});

const querySchema = z.object({
  org: z.string().uuid(),
  q: z.string().trim().max(200).optional(),
  url: z.string().trim().max(2048).optional(),
  index: z.enum(["all", "indexed", "not_indexed", "unknown", "gsc_only"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%,()]/g, " ").trim();
}

type CrawlStatusRow = {
  id: string;
  status: string;
  pages_crawled: number;
  pages_discovered: number;
  max_pages: number;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
  gsc_sync_status: string | null;
};

async function fetchActiveCrawl(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<CrawlStatusRow | null> {
  await syncCrawlJobHealth(orgId);

  const { data } = await supabase
    .from("dt_site_crawls")
    .select(
      "id,status,pages_crawled,pages_discovered,max_pages,message,started_at,finished_at,gsc_sync_status",
    )
    .eq("organisation_id", orgId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CrawlStatusRow | null) ?? null;
}

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    org: url.searchParams.get("org"),
    q: url.searchParams.get("q") ?? undefined,
    url: url.searchParams.get("url") ?? undefined,
    index: url.searchParams.get("index") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, parsed.data.org);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const orgId = parsed.data.org;
  const service = createServiceClient();
  const { data: orgConfig } = await service
    .from("dt_org_config")
    .select("website_url")
    .eq("organisation_id", orgId)
    .maybeSingle();
  const origin = resolveOrigin(orgConfig?.website_url);

  if (parsed.data.url) {
    const pageUrl = parsed.data.url;
    let { data: page } = await auth.supabase
      .from("dt_site_pages")
      .select("url,title,h1,meta_description,text_content,is_excluded,crawled_at")
      .eq("organisation_id", orgId)
      .eq("url", pageUrl)
      .maybeSingle();

    if (!page) {
      const { data: fuzzy } = await auth.supabase
        .from("dt_site_pages")
        .select("url,title,h1,meta_description,text_content,is_excluded,crawled_at")
        .eq("organisation_id", orgId)
        .ilike("url", `%${sanitizeSearchTerm(pageUrl).slice(-120)}%`)
        .limit(1)
        .maybeSingle();
      page = fuzzy;
    }

    const extra = await loadPageIndexExtras(service, orgId, page?.url ?? pageUrl);
    if (!page && !extra.gsc) {
      return NextResponse.json({ ok: false, message: "Seite nicht gefunden." }, { status: 404 });
    }

    const inGsc = Boolean(extra.gsc);
    return NextResponse.json({
      ok: true,
      page: {
        url: page?.url ?? extra.gsc?.url ?? pageUrl,
        title: page?.title ?? null,
        h1: page?.h1 ?? null,
        meta_description: page?.meta_description ?? null,
        text_content: page?.text_content ?? null,
        is_excluded: page?.is_excluded ?? false,
        crawled_at: page?.crawled_at ?? null,
        inCrawl: Boolean(page),
        inGsc,
        indexStatus: derivePageIndexStatus({
          gscSynced: extra.gscSynced,
          inGsc,
          inspectionCoverage: extra.inspection?.coverage_state,
          inspectionVerdict: extra.inspection?.verdict,
        }),
        gscClicks: extra.gsc?.clicks ?? null,
        gscImpressions: extra.gsc?.impressions ?? null,
        gscPosition: extra.gsc?.position ?? null,
        inspectionCoverage: extra.inspection?.coverage_state ?? null,
        inspectionVerdict: extra.inspection?.verdict ?? null,
      },
    });
  }

  const limit = parsed.data.limit ?? 80;
  const offset = parsed.data.offset ?? 0;
  const search = parsed.data.q ? sanitizeSearchTerm(parsed.data.q) : "";
  const indexFilter = (parsed.data.index ?? "all") as CrawlIndexFilter;

  let snapshot;
  try {
    snapshot = await loadCrawlViewerSnapshot({
      organisationId: orgId,
      origin,
      q: search || undefined,
      index: indexFilter,
      offset,
      limit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Crawl-Daten konnten nicht geladen werden.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }

  const [{ count: crawledCount }, { count: withTextCount }, { data: latest }, activeCrawl, { data: lastCrawl }] =
    await Promise.all([
      auth.supabase
        .from("dt_site_pages")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId),
      auth.supabase
        .from("dt_site_pages")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .not("text_content", "is", null)
        .neq("text_content", ""),
      auth.supabase
        .from("dt_site_pages")
        .select("crawled_at")
        .eq("organisation_id", orgId)
        .order("crawled_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      fetchActiveCrawl(service, orgId),
      service
        .from("dt_site_crawls")
        .select("status,message,finished_at,gsc_sync_status")
        .eq("organisation_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  return NextResponse.json({
    ok: true,
    count: snapshot.counts.total,
    crawledCount: crawledCount ?? 0,
    withTextCount: withTextCount ?? 0,
    lastCrawledAt: latest?.crawled_at ?? null,
    total: snapshot.total,
    limit,
    offset,
    index: indexFilter,
    counts: snapshot.counts,
    gscSynced: snapshot.gscSynced || lastCrawl?.gsc_sync_status === "done",
    gscFetchedAt: snapshot.gscFetchedAt,
    gscSyncStatus: activeCrawl?.gsc_sync_status ?? lastCrawl?.gsc_sync_status ?? null,
    pages: snapshot.pages,
    crawl: activeCrawl
      ? {
          id: activeCrawl.id,
          status: activeCrawl.status,
          pagesCrawled: activeCrawl.pages_crawled,
          pagesDiscovered: activeCrawl.pages_discovered,
          maxPages: activeCrawl.max_pages,
          message: activeCrawl.message,
          startedAt: activeCrawl.started_at,
          finishedAt: activeCrawl.finished_at,
          gscSyncStatus: activeCrawl.gsc_sync_status,
        }
      : null,
    lastCrawlError:
      lastCrawl?.status === "error" ? (lastCrawl.message ?? "Crawl fehlgeschlagen.") : null,
  });
}

async function loadPageIndexExtras(
  supabase: ReturnType<typeof createServiceClient>,
  organisationId: string,
  pageUrl: string,
): Promise<{
  gsc: {
    url: string;
    clicks: number;
    impressions: number;
    position: number | null;
  } | null;
  inspection: { coverage_state: string | null; verdict: string | null } | null;
  gscSynced: boolean;
}> {
  const [{ data: gscExact }, { count: gscCount }, { data: inspectionExact }] = await Promise.all([
    supabase
      .from("dt_seo_gsc_pages")
      .select("url,clicks,impressions,position")
      .eq("organisation_id", organisationId)
      .eq("url", pageUrl)
      .maybeSingle(),
    supabase
      .from("dt_seo_gsc_pages")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId),
    supabase
      .from("dt_seo_url_index_status")
      .select("url,verdict,coverage_state")
      .eq("organisation_id", organisationId)
      .eq("url", pageUrl)
      .maybeSingle(),
  ]);

  let gsc = gscExact;
  if (!gsc) {
    const { data: gscFuzzy } = await supabase
      .from("dt_seo_gsc_pages")
      .select("url,clicks,impressions,position")
      .eq("organisation_id", organisationId)
      .ilike("url", `%${sanitizeSearchTerm(pageUrl).slice(-120)}%`)
      .limit(1)
      .maybeSingle();
    gsc = gscFuzzy;
  }

  let inspection = inspectionExact;
  if (!inspection) {
    const { data: inspFuzzy } = await supabase
      .from("dt_seo_url_index_status")
      .select("url,verdict,coverage_state")
      .eq("organisation_id", organisationId)
      .ilike("url", `%${sanitizeSearchTerm(pageUrl).slice(-120)}%`)
      .limit(1)
      .maybeSingle();
    inspection = inspFuzzy;
  }

  return {
    gsc: gsc
      ? {
          url: gsc.url,
          clicks: gsc.clicks,
          impressions: gsc.impressions,
          position: gsc.position,
        }
      : null,
    inspection: inspection
      ? { coverage_state: inspection.coverage_state, verdict: inspection.verdict }
      : null,
    gscSynced: (gscCount ?? 0) > 0,
  };
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("action") === "stop") {
    const orgId = url.searchParams.get("org");
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
    }
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
    const service = createServiceClient();
    const { data: active } = await service
      .from("dt_site_crawls")
      .select("id")
      .eq("organisation_id", orgId)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (!active) {
      return NextResponse.json({ ok: false, message: "Kein aktiver Crawl." }, { status: 404 });
    }
    await service
      .from("dt_site_crawls")
      .update({
        status: "cancelled",
        message: "Vom Benutzer abgebrochen.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", active.id);
    await service
      .from("dt_crawl_queue")
      .update({ status: "error" })
      .eq("crawl_id", active.id)
      .in("status", ["pending", "processing"]);
    return NextResponse.json({ ok: true, message: "Crawl abgebrochen." });
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

  const started = await startOrganisationSiteCrawl({
    organisationId: parsed.data.organisationId,
    userId: auth.userId,
  });
  if (!started.ok) {
    const status = /Website- oder Sitemap/i.test(started.message) ? 400 : 500;
    return NextResponse.json({ ok: false, message: started.message }, { status });
  }

  return NextResponse.json({
    ok: true,
    crawlId: started.crawlId,
    reused: started.reused,
    message: started.message,
    status: started.status,
    pagesCrawled: started.pagesCrawled,
    pagesDiscovered: started.pagesDiscovered,
  });
}
