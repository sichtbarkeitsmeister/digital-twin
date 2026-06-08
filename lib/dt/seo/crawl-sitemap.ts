import { isDtExcludedPageUrl } from "@/lib/dt/seo/build-seo-context";

const MAX_PAGES = 80;

export async function fetchUrlsFromSitemap(sitemapUrl: string): Promise<string[]> {
  const res = await fetch(sitemapUrl, {
    headers: { "User-Agent": "DigitalTwin-SBKM-Crawler/1.0" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Sitemap nicht erreichbar (${res.status}).`);
  const xml = await res.text();
  return parseSitemapXml(xml, sitemapUrl);
}

function parseSitemapXml(xml: string, baseUrl: string): string[] {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
  const unique = [...new Set(locs)];
  if (unique.length > 0) return unique.slice(0, MAX_PAGES);

  if (xml.includes("<sitemapindex")) {
    return [];
  }

  try {
    const origin = new URL(baseUrl).origin;
    return [`${origin}/`];
  } catch {
    return [];
  }
}

export async function crawlOrganisationSitePages(input: {
  organisationId: string;
  websiteUrl: string | null;
  sitemapUrl: string | null;
  upsert: (
    rows: Array<{ url: string; title: string | null; is_excluded: boolean }>,
  ) => Promise<void>;
}): Promise<{ count: number; message: string }> {
  let urls: string[] = [];

  if (input.sitemapUrl?.trim()) {
    urls = await fetchUrlsFromSitemap(input.sitemapUrl.trim());
  } else if (input.websiteUrl?.trim()) {
    urls = [input.websiteUrl.trim()];
  } else {
    return { count: 0, message: "Keine Website- oder Sitemap-URL konfiguriert." };
  }

  const rows: Array<{ url: string; title: string | null; is_excluded: boolean }> = [];

  for (const url of urls.slice(0, MAX_PAGES)) {
    const excluded = isDtExcludedPageUrl(url);
    let title: string | null = null;
    if (!excluded) {
      try {
        const pageRes = await fetch(url, {
          headers: { "User-Agent": "DigitalTwin-SBKM-Crawler/1.0" },
          signal: AbortSignal.timeout(12_000),
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          title = m?.[1]?.trim().slice(0, 200) ?? null;
        }
      } catch {
        /* skip title */
      }
    }
    rows.push({ url, title, is_excluded: excluded });
  }

  await input.upsert(rows);
  const active = rows.filter((r) => !r.is_excluded).length;
  return {
    count: rows.length,
    message: `${rows.length} URLs verarbeitet (${active} prüfbar).`,
  };
}
