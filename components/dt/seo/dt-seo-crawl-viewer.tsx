"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Search,
} from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { cn } from "@/components/dt/cn";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 50;

export type CrawlPageSummary = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string;
};

export type CrawlPageDetail = CrawlPageSummary & {
  text_content: string | null;
};

function pageLabel(page: { title: string | null; h1: string | null; url: string }): string {
  return page.title?.trim() || page.h1?.trim() || page.url;
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".0", "")}k`;
  return String(n);
}

export function DtSeoCrawlViewer(props: { organisationId: string; organisationName?: string }) {
  const [stats, setStats] = useState<{
    count: number;
    withTextCount: number;
    lastCrawledAt: string | null;
  } | null>(null);
  const [activeCrawl, setActiveCrawl] = useState<{
    status: string;
    pagesCrawled: number;
    pagesDiscovered: number;
    maxPages: number;
    message: string | null;
  } | null>(null);
  const [pages, setPages] = useState<CrawlPageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrawlPageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams({
      org: props.organisationId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (debouncedSearch) params.set("q", debouncedSearch);

    const res = await fetch(`/api/dt/seo/crawl?${params}`);
    const json = (await res.json()) as {
      ok?: boolean;
      count?: number;
      withTextCount?: number;
      lastCrawledAt?: string | null;
      total?: number;
      pages?: CrawlPageSummary[];
      crawl?: {
        status: string;
        pagesCrawled: number;
        pagesDiscovered: number;
        maxPages: number;
        message: string | null;
      } | null;
    };
    setLoadingList(false);
    if (!json.ok) return;

    setStats({
      count: json.count ?? 0,
      withTextCount: json.withTextCount ?? 0,
      lastCrawledAt: json.lastCrawledAt ?? null,
    });
    setActiveCrawl(json.crawl ?? null);
    setTotal(json.total ?? 0);
    const rows = json.pages ?? [];
    setPages(rows);
  }, [props.organisationId, offset, debouncedSearch]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const active = activeCrawl && (activeCrawl.status === "queued" || activeCrawl.status === "running");
    if (!active) return;
    const t = setInterval(() => void loadList(), 4000);
    return () => clearInterval(t);
  }, [loadList, activeCrawl?.status]);

  useEffect(() => {
    if (pages.length === 0) {
      setSelectedUrl(null);
      return;
    }
    setSelectedUrl((current) => {
      if (current && pages.some((p) => p.url === current)) return current;
      return pages[0]!.url;
    });
  }, [pages]);

  useEffect(() => {
    if (!selectedUrl) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void fetch(
      `/api/dt/seo/crawl?org=${encodeURIComponent(props.organisationId)}&url=${encodeURIComponent(selectedUrl)}`,
    )
      .then((r) => r.json())
      .then((json: { ok?: boolean; page?: CrawlPageDetail }) => {
        if (cancelled) return;
        setDetail(json.ok && json.page ? json.page : null);
        setLoadingDetail(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.organisationId, selectedUrl]);

  const pageRange = useMemo(() => {
    if (total === 0) return "0";
    const from = offset + 1;
    const to = Math.min(offset + PAGE_SIZE, total);
    return `${from}–${to} von ${total}`;
  }, [offset, total]);

  const settingsHref = `/dashboard/verwaltung/seo?org=${encodeURIComponent(props.organisationId)}&tab=settings`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href={settingsHref}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sbkm-ink-600 transition-colors hover:text-sbkm-mint dark:text-white/55 dark:hover:text-sbkm-mint"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Zurück zu SEO-Einstellungen
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-sbkm-navy sm:text-2xl dark:text-white">
            Gecrawlte Website-Inhalte
          </h1>
          {props.organisationName ? (
            <p className="text-sm text-sbkm-ink-600 dark:text-white/60">{props.organisationName}</p>
          ) : null}
        </div>
        {stats ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <StatPill label="Seiten gesamt" value={String(stats.count)} />
            <StatPill label="Mit Text" value={String(stats.withTextCount)} />
            {stats.lastCrawledAt ? (
              <StatPill
                label="Zuletzt"
                value={new Date(stats.lastCrawledAt).toLocaleString("de-DE")}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {activeCrawl && (activeCrawl.status === "queued" || activeCrawl.status === "running") ? (
        <DtGlassCard className="border-sbkm-mint/30 bg-sbkm-mint/10 px-4 py-3 text-sm text-sbkm-navy dark:text-white">
          <p className="font-semibold">Crawl läuft …</p>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
            {activeCrawl.pagesCrawled} von {activeCrawl.pagesDiscovered || activeCrawl.maxPages} Seiten
            gecrawlt
            {activeCrawl.message ? ` · ${activeCrawl.message}` : ""}
          </p>
        </DtGlassCard>
      ) : null}

      {stats && stats.count === 0 ? (
        <DtGlassCard className="p-6 text-sm text-sbkm-ink-600 dark:text-white/60">
          Noch keine Seiten gecrawlt.{" "}
          <Link href={settingsHref} className="font-semibold text-sbkm-mint hover:underline">
            Jetzt crawlen
          </Link>
        </DtGlassCard>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,340px)_1fr] lg:items-stretch">
          <DtGlassCard className="flex min-h-[320px] min-w-0 flex-col overflow-hidden p-0 lg:max-h-[calc(100vh-12rem)]">
            <div className="shrink-0 border-b border-sbkm-navy/10 p-3 dark:border-white/10">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sbkm-ink-400 dark:text-white/35"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="URL, Titel, H1, Meta …"
                  className="pl-9"
                />
              </div>
              <p className="mt-2 text-[11px] text-sbkm-ink-500 dark:text-white/45">{pageRange}</p>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
              {loadingList ? (
                <li className="flex items-center justify-center gap-2 p-8 text-sm text-sbkm-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Lädt …
                </li>
              ) : pages.length === 0 ? (
                <li className="p-6 text-center text-sm text-sbkm-ink-500">Keine Treffer.</li>
              ) : (
                pages.map((page) => {
                  const active = page.url === selectedUrl;
                  return (
                    <li key={page.url}>
                      <button
                        type="button"
                        onClick={() => setSelectedUrl(page.url)}
                        className={cn(
                          "w-full border-b border-sbkm-navy/6 px-3 py-2.5 text-left transition-colors dark:border-white/6",
                          active
                            ? "bg-sbkm-mint/10 dark:bg-sbkm-mint/15"
                            : "hover:bg-sbkm-navy/[0.03] dark:hover:bg-white/[0.04]",
                        )}
                      >
                        <p className="line-clamp-2 text-sm font-semibold text-sbkm-navy dark:text-white">
                          {pageLabel(page)}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-sbkm-ink-500 dark:text-white/45">
                          {page.url}
                        </p>
                        {page.is_excluded ? (
                          <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            Ausgeschlossen
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {total > PAGE_SIZE ? (
              <div className="flex shrink-0 items-center justify-between border-t border-sbkm-navy/10 p-2 dark:border-white/10">
                <button
                  type="button"
                  disabled={offset === 0 || loadingList}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  className="inline-flex items-center gap-1 rounded-dt px-2 py-1 text-xs font-semibold text-sbkm-navy disabled:opacity-40 dark:text-white"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Zurück
                </button>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= total || loadingList}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  className="inline-flex items-center gap-1 rounded-dt px-2 py-1 text-xs font-semibold text-sbkm-navy disabled:opacity-40 dark:text-white"
                >
                  Weiter
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </DtGlassCard>

          <DtGlassCard className="flex min-h-[320px] min-w-0 flex-col overflow-hidden p-0 lg:max-h-[calc(100vh-12rem)]">
            {!selectedUrl ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-sbkm-ink-500">
                Wähle eine Seite aus der Liste.
              </div>
            ) : loadingDetail ? (
              <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-sbkm-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Seite wird geladen …
              </div>
            ) : !detail ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-sbkm-ink-500">
                Seite konnte nicht geladen werden.
              </div>
            ) : (
              <>
                <header className="shrink-0 border-b border-sbkm-navy/10 p-4 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-bold tracking-tight text-sbkm-navy dark:text-white">
                        {pageLabel(detail)}
                      </p>
                      <a
                        href={detail.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-sbkm-mint hover:underline"
                      >
                        {detail.url}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                      </a>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-sbkm-ink-500 dark:text-white/45">
                      {detail.text_content?.trim() ? (
                        <span className="rounded-pill bg-sbkm-navy/5 px-2 py-0.5 dark:bg-white/10">
                          {formatChars(detail.text_content.trim().length)} Zeichen
                        </span>
                      ) : null}
                      <span className="rounded-pill bg-sbkm-navy/5 px-2 py-0.5 dark:bg-white/10">
                        {new Date(detail.crawled_at).toLocaleString("de-DE")}
                      </span>
                    </div>
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle p-4">
                  <dl className="grid gap-4">
                    {detail.h1?.trim() && detail.h1.trim() !== pageLabel(detail) ? (
                      <Field label="H1" icon={<Globe className="h-3.5 w-3.5" />} value={detail.h1.trim()} />
                    ) : null}
                    {detail.meta_description?.trim() ? (
                      <Field
                        label="Meta-Description"
                        icon={<FileText className="h-3.5 w-3.5" />}
                        value={detail.meta_description.trim()}
                      />
                    ) : null}
                    <div>
                      <dt className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55">
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        Vollständiger Textinhalt
                      </dt>
                      <dd>
                        {detail.text_content?.trim() ? (
                          <pre className="whitespace-pre-wrap break-words rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.02] p-4 font-sans text-sm leading-relaxed text-sbkm-navy dark:border-white/10 dark:bg-white/[0.03] dark:text-white/90">
                            {detail.text_content.trim()}
                          </pre>
                        ) : (
                          <p className="text-sm italic text-sbkm-ink-400 dark:text-white/35">
                            Kein Textinhalt erfasst — evtl. JavaScript-gerendert oder leere Seite.
                          </p>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </>
            )}
          </DtGlassCard>
        </div>
      )}
    </div>
  );
}

function StatPill(props: { label: string; value: string }) {
  return (
    <span className="rounded-pill border border-sbkm-navy/10 bg-white/60 px-2.5 py-1 dark:border-white/10 dark:bg-white/5">
      <span className="text-sbkm-ink-500 dark:text-white/45">{props.label}: </span>
      <span className="font-semibold text-sbkm-navy dark:text-white">{props.value}</span>
    </span>
  );
}

function Field(props: { label: string; icon: ReactNode; value: string }) {
  return (
    <div>
      <dt className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55">
        {props.icon}
        {props.label}
      </dt>
      <dd className="text-sm leading-relaxed text-sbkm-navy dark:text-white/85">{props.value}</dd>
    </div>
  );
}
