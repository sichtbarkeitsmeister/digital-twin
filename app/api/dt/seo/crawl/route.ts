import { NextResponse } from "next/server";
import { z } from "zod";

import { loadOrgConfig, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { syncCrawlJobHealth } from "@/lib/dt/seo/sync-crawl-job-health";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { enqueueJob } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 60;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
});

const querySchema = z.object({
  org: z.string().uuid(),
  q: z.string().trim().max(200).optional(),
  url: z.string().trim().max(2048).optional(),
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
};

async function fetchActiveCrawl(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<CrawlStatusRow | null> {
  await syncCrawlJobHealth(orgId);

  const { data } = await supabase
    .from("dt_site_crawls")
    .select(
      "id,status,pages_crawled,pages_discovered,max_pages,message,started_at,finished_at",
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

  // Single page — full text for the crawl viewer detail panel.
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

    if (!page) {
      return NextResponse.json({ ok: false, message: "Seite nicht gefunden." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, page });
  }

  const limit = parsed.data.limit ?? 80;
  const offset = parsed.data.offset ?? 0;
  const search = parsed.data.q ? sanitizeSearchTerm(parsed.data.q) : "";

  let listQuery = auth.supabase
    .from("dt_site_pages")
    .select("url,title,h1,meta_description,is_excluded,crawled_at", { count: "exact" })
    .eq("organisation_id", orgId)
    .order("url", { ascending: true })
    .range(offset, offset + limit - 1);

  if (search) {
    listQuery = listQuery.or(
      `url.ilike.%${search}%,title.ilike.%${search}%,h1.ilike.%${search}%,meta_description.ilike.%${search}%`,
    );
  }

  const [{ count: totalCount }, { count: withTextCount }, { data: latest }, listRes, activeCrawl, { data: lastCrawl }] =
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
      listQuery,
      fetchActiveCrawl(service, orgId),
      service
        .from("dt_site_crawls")
        .select("status,message,finished_at")
        .eq("organisation_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (listRes.error) {
    return NextResponse.json({ ok: false, message: listRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    count: totalCount ?? 0,
    withTextCount: withTextCount ?? 0,
    lastCrawledAt: latest?.crawled_at ?? null,
    total: listRes.count ?? 0,
    limit,
    offset,
    pages: listRes.data ?? [],
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
        }
      : null,
    lastCrawlError:
      lastCrawl?.status === "error" ? (lastCrawl.message ?? "Crawl fehlgeschlagen.") : null,
  });
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

  const config = await loadOrgConfig(parsed.data.organisationId);
  if (!config) {
    return NextResponse.json({ ok: false, message: "Organisation nicht gefunden." }, { status: 404 });
  }

  if (!config.website_url?.trim() && !config.sitemap_url?.trim()) {
    return NextResponse.json(
      { ok: false, message: "Bitte Website- oder Sitemap-URL konfigurieren." },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  await syncCrawlJobHealth(parsed.data.organisationId);

  const { data: existing } = await service
    .from("dt_site_crawls")
    .select("id,status,pages_crawled,pages_discovered,message")
    .eq("organisation_id", parsed.data.organisationId)
    .in("status", ["queued", "running"])
    .maybeSingle();

  if (existing) {
    kickJobsWorker();
    return NextResponse.json({
      ok: true,
      crawlId: existing.id,
      reused: true,
      message: existing.message ?? "Crawl läuft bereits.",
      status: existing.status,
      pagesCrawled: existing.pages_crawled,
      pagesDiscovered: existing.pages_discovered,
    });
  }

  const { data: crawl, error: insertError } = await service
    .from("dt_site_crawls")
    .insert({
      organisation_id: parsed.data.organisationId,
      status: "queued",
      created_by_user_id: auth.userId,
      message: "Crawl in Warteschlange …",
    })
    .select("id")
    .single();

  if (insertError || !crawl) {
    return NextResponse.json(
      { ok: false, message: insertError?.message ?? "Crawl konnte nicht gestartet werden." },
      { status: 500 },
    );
  }

  const enqueued = await enqueueJob({
    kind: "seo.crawl",
    organisationId: parsed.data.organisationId,
    payload: { crawlId: crawl.id, organisationId: parsed.data.organisationId },
    runAfter: new Date(),
  });

  if (!enqueued.ok) {
    await service
      .from("dt_site_crawls")
      .update({ status: "error", message: enqueued.error, finished_at: new Date().toISOString() })
      .eq("id", crawl.id);
    return NextResponse.json({ ok: false, message: enqueued.error }, { status: 500 });
  }

  kickJobsWorker(5);

  return NextResponse.json({
    ok: true,
    crawlId: crawl.id,
    message: "Hintergrund-Crawl gestartet.",
    status: "queued",
  });
}
