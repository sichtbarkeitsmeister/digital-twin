"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Search,
} from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { cn } from "@/components/dt/cn";
import { Input } from "@/components/ui/input";
import { indexStatusLabel, type CrawlIndexFilter, type PageIndexStatus } from "@/lib/dt/seo/gsc-pages";

const PAGE_SIZE = 50;

export type CrawlPageSummary = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string | null;
  inCrawl?: boolean;
  inGsc?: boolean;
  indexStatus?: PageIndexStatus;
  indexReason?: string | null;
  isRedirect?: boolean;
  redirectTarget?: string | null;
  gscClicks?: number | null;
  gscImpressions?: number | null;
  gscPosition?: number | null;
  inspectionCoverage?: string | null;
  inspectionVerdict?: string | null;
};

export type CrawlPageDetail = CrawlPageSummary & {
  text_content: string | null;
};

type IndexCounts = {
  total: number;
  crawled: number;
  gsc: number;
  gscOnly: number;
  indexed: number;
  notIndexed: number;
  unknown: number;
  redirects: number;
};

const INDEX_FILTERS: { id: CrawlIndexFilter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "indexed", label: "Indexiert" },
  { id: "not_indexed", label: "Nicht indexiert" },
  { id: "redirect", label: "Weiterleitung" },
  { id: "gsc_only", label: "Nur in GSC" },
];

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
    crawledCount: number;
    withTextCount: number;
    lastCrawledAt: string | null;
    counts: IndexCounts | null;
    gscSynced: boolean;
    gscFetchedAt: string | null;
    gscSyncStatus: string | null;
  } | null>(null);
  const [activeCrawl, setActiveCrawl] = useState<{
    status: string;
    pagesCrawled: number;
    pagesDiscovered: number;
    maxPages: number;
    message: string | null;
    gscSyncStatus?: string | null;
  } | null>(null);
  const [lastCrawlError, setLastCrawlError] = useState<string | null>(null);
  const [pages, setPages] = useState<CrawlPageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [indexFilter, setIndexFilter] = useState<CrawlIndexFilter>("all");
  const [loadingList, setLoadingList] = useState(true);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrawlPageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [indexFilter]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams({
      org: props.organisationId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (indexFilter !== "all") params.set("index", indexFilter);

    const res = await fetch(`/api/dt/seo/crawl?${params}`);
    const json = (await res.json()) as {
      ok?: boolean;
      count?: number;
      crawledCount?: number;
      withTextCount?: number;
      lastCrawledAt?: string | null;
      total?: number;
      pages?: CrawlPageSummary[];
      counts?: IndexCounts;
      gscSynced?: boolean;
      gscFetchedAt?: string | null;
      gscSyncStatus?: string | null;
      crawl?: {
        status: string;
        pagesCrawled: number;
        pagesDiscovered: number;
        maxPages: number;
        message: string | null;
        gscSyncStatus?: string | null;
      } | null;
      lastCrawlError?: string | null;
    };
    setLoadingList(false);
    if (!json.ok) return;

    setStats({
      count: json.count ?? 0,
      crawledCount: json.crawledCount ?? json.count ?? 0,
      withTextCount: json.withTextCount ?? 0,
      lastCrawledAt: json.lastCrawledAt ?? null,
      counts: json.counts ?? null,
      gscSynced: Boolean(json.gscSynced),
      gscFetchedAt: json.gscFetchedAt ?? null,
      gscSyncStatus: json.gscSyncStatus ?? json.crawl?.gscSyncStatus ?? null,
    });
    setActiveCrawl(json.crawl ?? null);
    setLastCrawlError(json.lastCrawlError ?? null);
    setTotal(json.total ?? 0);
    const rows = json.pages ?? [];
    setPages(rows);
  }, [props.organisationId, offset, debouncedSearch, indexFilter]);

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
    const fromList = pagesRef.current.find((page) => page.url === selectedUrl);
    if (fromList) {
      setDetail((current) =>
        current?.url === selectedUrl
          ? current
          : { ...fromList, text_content: current?.url === selectedUrl ? current.text_content : null },
      );
    }
    let cancelled = false;
    setLoadingDetail(true);
    void fetch(
      `/api/dt/seo/crawl?org=${encodeURIComponent(props.organisationId)}&url=${encodeURIComponent(selectedUrl)}`,
    )
      .then((r) => r.json())
      .then((json: { ok?: boolean; page?: CrawlPageDetail }) => {
        if (cancelled) return;
        if (json.ok && json.page) {
          setDetail({
            ...fromList,
            ...json.page,
            isRedirect: Boolean(json.page.isRedirect || fromList?.isRedirect),
            redirectTarget: json.page.redirectTarget || fromList?.redirectTarget || null,
            indexReason: json.page.indexReason || fromList?.indexReason || null,
          });
        } else {
          setDetail(fromList ? { ...fromList, text_content: null } : null);
        }
        setLoadingDetail(false);
      })
      .catch(() => {
        if (!cancelled) {
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

  async function downloadCsv() {
    setDownloadingCsv(true);
    setCsvError(null);
    try {
      const params = new URLSearchParams({
        org: props.organisationId,
        format: "csv",
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (indexFilter !== "all") params.set("index", indexFilter);
      const res = await fetch(`/api/dt/seo/crawl?${params}`);
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Download fehlgeschlagen.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seiten-indexstatus-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : "Download fehlgeschlagen.");
    } finally {
      setDownloadingCsv(false);
    }
  }

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
            Website-Seiten & Indexstatus
          </h1>
          {props.organisationName ? (
            <p className="text-sm text-sbkm-ink-600 dark:text-white/60">{props.organisationName}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {stats && stats.count > 0 ? (
            <button
              type="button"
              disabled={downloadingCsv}
              onClick={() => void downloadCsv()}
              title="Alle aktuell gefilterten Seiten inkl. Indexstatus als Excel-CSV"
              className="inline-flex items-center gap-1.5 rounded-pill border border-sbkm-navy/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-sbkm-navy transition-colors hover:border-sbkm-navy/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-white"
            >
              {downloadingCsv ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
              Als CSV herunterladen
            </button>
          ) : null}
          {csvError ? (
            <p className="text-[11px] text-red-700 dark:text-red-300" role="alert">
              {csvError}
            </p>
          ) : null}
          {stats ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <StatPill label="Seiten gesamt" value={String(stats.counts?.total ?? stats.count)} />
              <StatPill label="Indexiert" value={String(stats.counts?.indexed ?? "—")} />
              <StatPill label="Nicht indexiert" value={String(stats.counts?.notIndexed ?? "—")} />
              {stats.counts?.redirects ? (
                <StatPill label="Weiterleitung" value={String(stats.counts.redirects)} />
              ) : null}
              {stats.counts?.gscOnly ? (
                <StatPill label="Nur in GSC" value={String(stats.counts.gscOnly)} />
              ) : null}
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

      {lastCrawlError || activeCrawl?.status === "error" ? (
        <div
          className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-900 dark:text-red-100"
          role="alert"
        >
          <p className="font-semibold">Crawl-Fehler</p>
          <p className="mt-1 text-xs">
            {activeCrawl?.status === "error"
              ? activeCrawl.message || lastCrawlError || "Crawl fehlgeschlagen."
              : lastCrawlError}
          </p>
        </div>
      ) : null}

      {stats && stats.gscSyncStatus === "pending" ? (
        <DtGlassCard className="border-sbkm-navy/10 px-4 py-3 text-sm text-sbkm-navy dark:text-white">
          Search-Console-Seiten werden abgeglichen …
        </DtGlassCard>
      ) : null}

      {stats && stats.count === 0 ? (
        <DtGlassCard className="p-6 text-sm text-sbkm-ink-600 dark:text-white/60">
          Noch keine Seiten gespeichert.{" "}
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
              <div className="mt-2 flex flex-wrap gap-1">
                {INDEX_FILTERS.map((filter) => {
                  const active = indexFilter === filter.id;
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setIndexFilter(filter.id)}
                      className={cn(
                        "rounded-pill px-2.5 py-1 text-[11px] font-semibold transition-colors",
                        active
                          ? "bg-sbkm-navy text-white dark:bg-sbkm-mint dark:text-sbkm-navy"
                          : "bg-sbkm-navy/5 text-sbkm-ink-600 hover:bg-sbkm-navy/10 dark:bg-white/10 dark:text-white/70",
                      )}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-sbkm-ink-500 dark:text-white/45">{pageRange}</p>
              <p className="mt-1 text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
                Indexiert = genau diese URL in den Search-Console-Leistungsdaten (90 Tage) oder
                URL-Inspection PASS. www-/http-Varianten und Weiterleitungen zählen wie in GSC
                als nicht indexiert. Den vollen Coverage-Bericht mit allen Ausschlussgründen
                liefert Google nicht per API.
              </p>
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
                        <div className="mt-1 flex flex-wrap gap-1">
                          <IndexBadge status={page.indexStatus} />
                          {page.isRedirect ? (
                            <RedirectBadge target={page.redirectTarget} />
                          ) : page.indexStatus === "not_indexed" && page.indexReason ? (
                            <span className="line-clamp-1 text-[10px] text-sbkm-ink-500 dark:text-white/45">
                              {page.indexReason}
                            </span>
                          ) : null}
                          {page.inGsc && !page.inCrawl ? (
                            <span className="inline-block rounded-pill bg-sbkm-navy/8 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70">
                              Nur GSC
                            </span>
                          ) : null}
                          {page.is_excluded ? (
                            <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                              Ausgeschlossen
                            </span>
                          ) : null}
                        </div>
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
            ) : loadingDetail && !detail ? (
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
                      <IndexBadge status={detail.indexStatus} />
                      {detail.isRedirect ? <RedirectBadge target={detail.redirectTarget} /> : null}
                      {detail.inGsc && !detail.inCrawl ? (
                        <span className="rounded-pill bg-sbkm-navy/5 px-2 py-0.5 dark:bg-white/10">
                          Nur in Search Console
                        </span>
                      ) : null}
                      {detail.text_content?.trim() ? (
                        <span className="rounded-pill bg-sbkm-navy/5 px-2 py-0.5 dark:bg-white/10">
                          {formatChars(detail.text_content.trim().length)} Zeichen
                        </span>
                      ) : null}
                      {detail.crawled_at ? (
                        <span className="rounded-pill bg-sbkm-navy/5 px-2 py-0.5 dark:bg-white/10">
                          {new Date(detail.crawled_at).toLocaleString("de-DE")}
                        </span>
                      ) : (
                        <span className="rounded-pill bg-sbkm-navy/5 px-2 py-0.5 dark:bg-white/10">
                          Noch nicht gecrawlt
                        </span>
                      )}
                    </div>
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle p-4">
                  <dl className="grid gap-4">
                    {detail.gscImpressions != null || detail.inspectionCoverage || detail.indexReason ? (
                      <div>
                        <dt className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55">
                          Search Console
                        </dt>
                        <dd className="text-sm leading-relaxed text-sbkm-navy dark:text-white/85">
                          {detail.gscImpressions != null ? (
                            <p>
                              {detail.gscImpressions.toLocaleString("de-DE")} Impressionen
                              {detail.gscClicks != null
                                ? ` · ${detail.gscClicks.toLocaleString("de-DE")} Klicks`
                                : ""}
                              {detail.gscPosition != null
                                ? ` · Ø Position ${detail.gscPosition.toFixed(1)}`
                                : ""}
                              {detail.isRedirect ? " (Ziel-URL)" : ""}
                            </p>
                          ) : (
                            <p>Keine Impressionen in den letzten 90 Tagen.</p>
                          )}
                          {detail.isRedirect ? (
                            <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                              Seite mit Weiterleitung
                              {detail.redirectTarget ? (
                                <>
                                  {" → "}
                                  <a
                                    href={detail.redirectTarget}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="break-all text-sbkm-mint hover:underline"
                                  >
                                    {detail.redirectTarget}
                                  </a>
                                </>
                              ) : null}
                            </p>
                          ) : detail.indexReason ? (
                            <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                              Indexgrund: {detail.indexReason}
                            </p>
                          ) : null}
                          {detail.inspectionCoverage ? (
                            <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                              URL-Inspection: {detail.inspectionCoverage}
                              {detail.inspectionVerdict ? ` (${detail.inspectionVerdict})` : ""}
                            </p>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
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
                            {detail.inGsc && !detail.inCrawl
                              ? "Diese URL kennt Google, unser Crawler hat sie noch nicht gespeichert. Beim nächsten Crawl wird sie mitgeladen."
                              : "Kein Textinhalt erfasst — evtl. JavaScript-gerendert oder leere Seite."}
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

function RedirectBadge(props: { target?: string | null }) {
  return (
    <span
      title={props.target ? `Weiterleitung → ${props.target}` : "Seite mit Weiterleitung"}
      className="inline-block rounded-pill bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300"
    >
      Weiterleitung
    </span>
  );
}

function IndexBadge(props: { status?: PageIndexStatus }) {
  const status = props.status ?? "unknown";
  const label = indexStatusLabel(status);
  const className =
    status === "indexed"
      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
      : status === "not_indexed"
        ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
        : "bg-sbkm-navy/8 text-sbkm-ink-600 dark:bg-white/10 dark:text-white/60";
  return (
    <span
      className={cn(
        "inline-block rounded-pill px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {label}
    </span>
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
