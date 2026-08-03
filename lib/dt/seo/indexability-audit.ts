/**
 * Bulk indexability audit: checks many URLs at once for the technical reasons
 * a page cannot rank — HTTP errors, noindex, foreign canonicals, redirects.
 *
 * This is our own live check, not Google's index state. The Search Console API
 * has no bulk coverage endpoint (only per-URL inspection), so this answers the
 * technical half of "why is this page not on Google?" without GSC.
 */
export type DtIndexabilityRow = {
  url: string;
  status: number | null;
  finalUrl: string | null;
  noindex: boolean;
  canonical: string | null;
  canonicalPointsElsewhere: boolean;
  redirected: boolean;
  inCrawlIndex: boolean;
  error: string | null;
};

export type DtIndexabilityAuditMeta = {
  source: "sitemap" | "crawl_index" | "explicit";
  sourceLabel: string;
  totalCandidates: number;
  checked: number;
  stoppedEarly: boolean;
};

const TRACKING_PARAM = /^(utm_|fbclid|gclid|msclkid|mc_)/i;

/**
 * Comparison key for "is this the same page?".
 *
 * Deliberately ignores what a site canonicalises anyway — scheme, `www.`,
 * default ports, trailing slash, fragment and tracking parameters — so that
 * normal setups do not get reported as problems.
 */
export function pageComparisonKey(value: string, base?: string | null): string | null {
  try {
    const url = new URL(value, base ?? undefined);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const port =
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
        ? ""
        : url.port;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const query = url.searchParams.toString();
    return `${host}${port ? `:${port}` : ""}${path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function sameUrl(a: string, b: string): boolean {
  const keyA = pageComparisonKey(a);
  const keyB = pageComparisonKey(b);
  return keyA !== null && keyA === keyB;
}

export function evaluateCanonical(
  requestedUrl: string,
  finalUrl: string | null,
  canonical: string | null,
): boolean {
  if (!canonical?.trim()) return false;
  const resolved = pageComparisonKey(canonical, finalUrl || requestedUrl);
  if (!resolved) return false;
  const finalKey = pageComparisonKey(finalUrl || requestedUrl);
  const requestedKey = pageComparisonKey(requestedUrl);
  return resolved !== finalKey && resolved !== requestedKey;
}

/**
 * True only when the final URL is a different page. `fetch` normalises the URL
 * (it drops the fragment), so a plain string comparison would report a
 * redirect for every URL that carries an anchor.
 */
export function isNotableRedirect(
  requestedUrl: string,
  finalUrl: string | null,
): boolean {
  if (!finalUrl) return false;
  return !sameUrl(requestedUrl, finalUrl);
}

function rowProblems(row: DtIndexabilityRow): string[] {
  const problems: string[] = [];
  if (row.error) problems.push(`nicht erreichbar (${row.error})`);
  else if (row.status && row.status >= 400) problems.push(`HTTP ${row.status}`);
  if (row.noindex) problems.push("noindex");
  if (row.canonicalPointsElsewhere) problems.push(`Canonical → ${row.canonical}`);
  if (row.redirected && row.finalUrl) problems.push(`Weiterleitung → ${row.finalUrl}`);
  return problems;
}

export function formatIndexabilityAudit(
  rows: DtIndexabilityRow[],
  meta: DtIndexabilityAuditMeta,
): string {
  if (rows.length === 0) {
    return "Keine URLs zum Prüfen gefunden. Bitte Sitemap-URL angeben oder in den SEO-Einstellungen „Jetzt crawlen“ ausführen.";
  }

  const blocked: string[] = [];
  const notCrawled: string[] = [];
  let clean = 0;

  for (const row of rows) {
    const problems = rowProblems(row);
    if (problems.length > 0) {
      blocked.push(`- ${row.url}: ${problems.join("; ")}`);
    } else {
      clean += 1;
      if (!row.inCrawlIndex) notCrawled.push(`- ${row.url}`);
    }
  }

  const lines = [
    `Indexierbarkeits-Check (${meta.sourceLabel})`,
    `Geprüft: ${meta.checked} von ${meta.totalCandidates} URLs${
      meta.stoppedEarly ? " (Zeitbudget erreicht — Rest ungeprüft)" : ""
    }`,
    `Technisch in Ordnung: ${clean} · Mit Problem: ${rows.length - clean}`,
  ];

  if (blocked.length > 0) {
    lines.push(
      "",
      "Diese Seiten können so nicht ranken:",
      ...blocked.slice(0, 25),
    );
    if (blocked.length > 25) lines.push(`… und ${blocked.length - 25} weitere.`);
  } else {
    lines.push("", "Keine technischen Blocker in der Stichprobe gefunden.");
  }

  if (notCrawled.length > 0) {
    lines.push(
      "",
      "Technisch in Ordnung, aber noch nicht in unserem Crawl-Index:",
      ...notCrawled.slice(0, 15),
    );
    if (notCrawled.length > 15) {
      lines.push(`… und ${notCrawled.length - 15} weitere.`);
    }
    lines.push(
      "Das sagt nichts über die Google-Indexierung aus — nur, dass unser Crawler die Seite noch nicht gespeichert hat.",
    );
  }

  lines.push(
    "",
    "Hinweis: Das ist ein Live-Check unsererseits (HTTP, Meta-Robots, Canonical) — kein Google-Indexierungsstatus.",
    "Ob Google eine Seite tatsächlich indexiert hat, ist hier nicht enthalten; dafür fehlen uns GSC-Daten.",
  );

  return lines.join("\n");
}
