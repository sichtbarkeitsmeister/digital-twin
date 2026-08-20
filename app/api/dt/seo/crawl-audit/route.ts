import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  auditCrawledPages,
  auditStructuredDataSamples,
  summarizeSeoAudit,
  type StructuredDataSample,
} from "@/lib/dt/seo/crawl-onpage-audit";
import { createServiceClient } from "@/lib/supabase/service";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

const querySchema = z.object({
  org: z.string().uuid(),
  /** Live-check structured data on a sample of pages (slower). */
  structured: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

const SAMPLE_LIVE = 8;
const FETCH_TIMEOUT_MS = 8_000;

async function sampleStructuredData(urls: string[]): Promise<StructuredDataSample[]> {
  const out: StructuredDataSample[] = [];
  for (const url of urls.slice(0, SAMPLE_LIVE)) {
    const safe = checkSafePublicUrl(url);
    if (!safe.ok) {
      out.push({ url, ok: false, hasJsonLd: false, types: [], error: safe.reason });
      continue;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; SichtbarkeitsmeisterBot/1.0; +https://sichtbarkeitsmeister.de)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        out.push({
          url,
          ok: false,
          hasJsonLd: false,
          types: [],
          error: `HTTP ${res.status}`,
        });
        continue;
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      const types: string[] = [];
      let hasJsonLd = false;
      $('script[type="application/ld+json"]').each((_, el) => {
        hasJsonLd = true;
        const raw = $(el).html() || "";
        try {
          const parsed = JSON.parse(raw) as unknown;
          const collect = (node: unknown) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
              for (const item of node) collect(item);
              return;
            }
            const obj = node as Record<string, unknown>;
            const t = obj["@type"];
            if (typeof t === "string" && t.trim()) types.push(t.trim());
            else if (Array.isArray(t)) {
              for (const x of t) if (typeof x === "string" && x.trim()) types.push(x.trim());
            }
            if (obj["@graph"]) collect(obj["@graph"]);
          };
          collect(parsed);
        } catch {
          /* ignore invalid JSON-LD */
        }
      });
      out.push({
        url,
        ok: true,
        hasJsonLd,
        types: [...new Set(types)].slice(0, 12),
      });
    } catch (err) {
      out.push({
        url,
        ok: false,
        hasJsonLd: false,
        types: [],
        error: err instanceof Error ? err.message : "Fetch fehlgeschlagen",
      });
    }
  }
  return out;
}

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    org: url.searchParams.get("org"),
    structured: url.searchParams.get("structured") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, parsed.data.org);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const service = createServiceClient();
  const [{ data: pages, error: pagesError }, { data: lastCrawl }, { data: lastReport }] =
    await Promise.all([
      service
        .from("dt_site_pages")
        .select("url,title,h1,meta_description,text_content,is_excluded")
        .eq("organisation_id", parsed.data.org)
        .eq("is_excluded", false)
        .order("updated_at", { ascending: false })
        .limit(500),
      service
        .from("dt_site_crawls")
        .select("id,status,message,finished_at")
        .eq("organisation_id", parsed.data.org)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("dt_seo_reports")
        .select("id,state,state_message,created_at")
        .eq("organisation_id", parsed.data.org)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (pagesError) {
    return NextResponse.json({ ok: false, message: pagesError.message }, { status: 500 });
  }

  const pageRows = pages ?? [];
  const findings = auditCrawledPages(pageRows);

  if (lastCrawl?.status === "error") {
    findings.unshift({
      code: "crawl_job_error",
      severity: "error",
      category: "crawl",
      title: "Letzter Crawl fehlgeschlagen",
      message: lastCrawl.message?.trim() || "Crawl-Job mit Status error.",
      count: 1,
      sampleUrls: [],
    });
  }

  if (lastReport?.state === "error") {
    findings.unshift({
      code: "report_job_error",
      severity: "error",
      category: "report",
      title: "Letzter SEO-Report fehlgeschlagen",
      message: lastReport.state_message?.trim() || "Report-Job mit Status error.",
      count: 1,
      sampleUrls: [],
    });
  }

  let structuredSamples: StructuredDataSample[] = [];
  if (parsed.data.structured && pageRows.length > 0) {
    const sampleUrls = pageRows.slice(0, SAMPLE_LIVE).map((p) => p.url);
    structuredSamples = await sampleStructuredData(sampleUrls);
    findings.push(...auditStructuredDataSamples(structuredSamples));
  }

  const summary = summarizeSeoAudit(findings);

  return NextResponse.json({
    ok: true,
    pageCount: pageRows.length,
    lastCrawl: lastCrawl
      ? {
          status: lastCrawl.status,
          message: lastCrawl.message,
          finishedAt: lastCrawl.finished_at,
        }
      : null,
    lastReport: lastReport
      ? {
          id: lastReport.id,
          state: lastReport.state,
          message: lastReport.state_message,
          createdAt: lastReport.created_at,
        }
      : null,
    structuredSamples,
    findings,
    summary,
  });
}
