/**
 * Deep on-page SEO findings from crawled pages (+ optional live structured-data sample).
 */

export type CrawlPageAuditInput = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  text_content: string | null;
  is_excluded?: boolean | null;
};

export type SeoAuditFinding = {
  code: string;
  severity: "error" | "warning";
  category: "onpage" | "content" | "structured_data" | "crawl" | "report";
  title: string;
  message: string;
  count: number;
  sampleUrls: string[];
};

export type StructuredDataSample = {
  url: string;
  ok: boolean;
  hasJsonLd: boolean;
  types: string[];
  error?: string | null;
};

const TITLE_MAX = 60;
const META_MAX = 160;
const THIN_CHARS = 200;
const SAMPLE_LIMIT = 8;

function pushFinding(
  into: SeoAuditFinding[],
  finding: Omit<SeoAuditFinding, "sampleUrls" | "count"> & { urls: string[] },
) {
  if (finding.urls.length === 0) return;
  into.push({
    code: finding.code,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    message: finding.message,
    count: finding.urls.length,
    sampleUrls: finding.urls.slice(0, SAMPLE_LIMIT),
  });
}

/**
 * Analyse stored crawl pages for classic on-page SEO problems.
 */
export function auditCrawledPages(pages: CrawlPageAuditInput[]): SeoAuditFinding[] {
  const findings: SeoAuditFinding[] = [];
  const active = pages.filter((p) => !p.is_excluded);

  if (active.length === 0) {
    findings.push({
      code: "crawl_empty",
      severity: "warning",
      category: "crawl",
      title: "Kein Crawl-Inhalt",
      message:
        "Noch keine gecrawlten Seiten — bitte unter Einstellungen crawlen, dann erneut analysieren.",
      count: 0,
      sampleUrls: [],
    });
    return findings;
  }

  const missingTitle = active.filter((p) => !p.title?.trim()).map((p) => p.url);
  pushFinding(findings, {
    code: "missing_title",
    severity: "error",
    category: "onpage",
    title: "Title-Tag fehlt",
    message: "Seiten ohne `<title>` — schlecht für SERP und Ranking.",
    urls: missingTitle,
  });

  const missingH1 = active.filter((p) => !p.h1?.trim()).map((p) => p.url);
  pushFinding(findings, {
    code: "missing_h1",
    severity: "error",
    category: "onpage",
    title: "H1 fehlt",
    message: "Seiten ohne erkennbare H1-Überschrift.",
    urls: missingH1,
  });

  const missingMeta = active
    .filter((p) => !p.meta_description?.trim())
    .map((p) => p.url);
  pushFinding(findings, {
    code: "missing_meta_description",
    severity: "warning",
    category: "onpage",
    title: "Meta-Description fehlt",
    message: "Ohne Meta-Description steuert Google den Snippet-Text oft ungünstig.",
    urls: missingMeta,
  });

  const longTitle = active
    .filter((p) => (p.title?.trim().length ?? 0) > TITLE_MAX)
    .map((p) => p.url);
  pushFinding(findings, {
    code: "title_too_long",
    severity: "warning",
    category: "onpage",
    title: `Title länger als ${TITLE_MAX} Zeichen`,
    message: "Sehr lange Titles werden in den SERPs oft abgeschnitten.",
    urls: longTitle,
  });

  const longMeta = active
    .filter((p) => (p.meta_description?.trim().length ?? 0) > META_MAX)
    .map((p) => p.url);
  pushFinding(findings, {
    code: "meta_too_long",
    severity: "warning",
    category: "onpage",
    title: `Meta-Description länger als ${META_MAX} Zeichen`,
    message: "Lange Descriptions werden häufig gekürzt.",
    urls: longMeta,
  });

  const thin = active
    .filter((p) => (p.text_content?.trim().length ?? 0) > 0 && (p.text_content?.trim().length ?? 0) < THIN_CHARS)
    .map((p) => p.url);
  pushFinding(findings, {
    code: "thin_content",
    severity: "warning",
    category: "content",
    title: "Dünner Inhalt",
    message: `Weniger als ${THIN_CHARS} Zeichen sichtbarer Text — prüfen, ob die Seite Mehrwert bietet.`,
    urls: thin,
  });

  const noText = active
    .filter((p) => !(p.text_content?.trim().length ?? 0))
    .map((p) => p.url);
  pushFinding(findings, {
    code: "no_text_content",
    severity: "error",
    category: "content",
    title: "Kein Textinhalt im Crawl",
    message: "Crawl hat keinen Text gespeichert (JS-only, Blocking oder Crawl-Fehler).",
    urls: noText,
  });

  const byTitle = new Map<string, string[]>();
  for (const p of active) {
    const t = p.title?.trim().toLowerCase();
    if (!t) continue;
    const list = byTitle.get(t) ?? [];
    list.push(p.url);
    byTitle.set(t, list);
  }
  const dupUrls: string[] = [];
  for (const urls of byTitle.values()) {
    if (urls.length >= 2) dupUrls.push(...urls);
  }
  pushFinding(findings, {
    code: "duplicate_title",
    severity: "warning",
    category: "onpage",
    title: "Doppelte Title-Tags",
    message: "Mehrere URLs teilen sich denselben Title — Differenzierung empfohlen.",
    urls: dupUrls,
  });

  return findings;
}

/**
 * Summarise live structured-data samples into findings.
 */
export function auditStructuredDataSamples(
  samples: StructuredDataSample[],
): SeoAuditFinding[] {
  if (samples.length === 0) return [];
  const findings: SeoAuditFinding[] = [];
  const without = samples.filter((s) => s.ok && !s.hasJsonLd).map((s) => s.url);
  const failed = samples.filter((s) => !s.ok).map((s) => s.url);

  pushFinding(findings, {
    code: "missing_json_ld",
    severity: "warning",
    category: "structured_data",
    title: "Kein JSON-LD / Structured Data",
    message:
      "In der Stichprobe kein `application/ld+json` gefunden (Organization, LocalBusiness, FAQ, …).",
    urls: without,
  });

  pushFinding(findings, {
    code: "structured_data_fetch_error",
    severity: "warning",
    category: "structured_data",
    title: "Structured-Data-Check fehlgeschlagen",
    message: "Einige URLs konnten live nicht geprüft werden.",
    urls: failed,
  });

  return findings;
}

export function summarizeSeoAudit(findings: SeoAuditFinding[]): {
  errorCount: number;
  warningCount: number;
  ok: boolean;
} {
  const errorCount = findings
    .filter((f) => f.severity === "error")
    .reduce((n, f) => n + Math.max(f.count, 1), 0);
  const warningCount = findings
    .filter((f) => f.severity === "warning")
    .reduce((n, f) => n + Math.max(f.count, 1), 0);
  return {
    errorCount,
    warningCount,
    ok: findings.filter((f) => f.severity === "error").length === 0,
  };
}
