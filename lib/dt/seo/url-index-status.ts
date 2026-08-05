import { createServiceClient } from "@/lib/supabase/service";

export type DtSeoUrlIndexStatusRow = {
  id: string;
  organisation_id: string;
  url: string;
  inspected_at: string;
  verdict: string | null;
  coverage_state: string | null;
  indexing_state: string | null;
  page_fetch_state: string | null;
  robots_txt_state: string | null;
  crawled_as: string | null;
  sitemap: string | null;
  referring_urls: unknown;
  raw: Record<string, unknown>;
};

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return u.toString();
  } catch {
    return url.trim();
  }
}

export async function loadDtSeoUrlIndexStatus(
  organisationId: string,
  opts?: { url?: string | null; limit?: number },
): Promise<DtSeoUrlIndexStatusRow[]> {
  const supabase = createServiceClient();
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  let query = supabase
    .from("dt_seo_url_index_status")
    .select(
      "id,organisation_id,url,inspected_at,verdict,coverage_state,indexing_state,page_fetch_state,robots_txt_state,crawled_as,sitemap,referring_urls,raw",
    )
    .eq("organisation_id", organisationId)
    .order("inspected_at", { ascending: false })
    .limit(limit);

  if (opts?.url?.trim()) {
    query = query.eq("url", normalizeUrlKey(opts.url));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DtSeoUrlIndexStatusRow[];
}

export function formatDtSeoUrlIndexStatusForTool(
  rows: DtSeoUrlIndexStatusRow[],
  opts?: { url?: string | null },
): string {
  if (rows.length === 0) {
    if (opts?.url?.trim()) {
      return (
        `Keine gespeicherten Google-Indexdaten für ${opts.url.trim()}. ` +
        "Technische Indexierbarkeit kannst du mit `audit_site_indexability` / `inspect_website_url` prüfen. " +
        "Für den echten GSC-Indexstatus muss zuerst eine URL-Inspection-Stichprobe laufen " +
        "(`request_gsc_index_check`)."
      );
    }
    return (
      "Noch keine Google-URL-Inspection-Daten gespeichert. " +
      "Es gibt keinen Coverage-Sync — nur Stichproben über die URL-Inspection-API. " +
      "Starte bei Bedarf `request_gsc_index_check` und frage später erneut."
    );
  }

  const lines = rows.map((row, i) => {
    const when = row.inspected_at
      ? new Date(row.inspected_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })
      : "unbekannt";
    return [
      `${i + 1}. ${row.url}`,
      `   Geprüft: ${when}`,
      `   Verdict: ${row.verdict ?? "—"}`,
      `   Coverage: ${row.coverage_state ?? "—"}`,
      `   Indexing: ${row.indexing_state ?? "—"}`,
      `   Fetch: ${row.page_fetch_state ?? "—"}`,
      `   robots.txt: ${row.robots_txt_state ?? "—"}`,
      row.sitemap ? `   Sitemap: ${row.sitemap}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return (
    `Gespeicherte Google-URL-Inspection-Stichproben (${rows.length}):\n\n` +
    `${lines.join("\n\n")}\n\n` +
    "Hinweis: Das ist kein vollständiger Coverage-Bericht, sondern einzelne URL-Prüfungen."
  );
}

export async function readIndexStatusForTool(
  organisationId: string,
  opts?: { url?: string | null; limit?: number },
): Promise<string> {
  const rows = await loadDtSeoUrlIndexStatus(organisationId, opts);
  return formatDtSeoUrlIndexStatusForTool(rows, { url: opts?.url });
}

export async function triggerGscIndexCheckN8n(input: {
  organisationId: string;
  urls?: string[];
  limit?: number;
}): Promise<string> {
  const webhook = process.env.N8N_DT_GSC_URL_INSPECTION_WEBHOOK?.trim();
  if (!webhook) {
    return (
      "GSC-URL-Inspection ist noch nicht angebunden " +
      "(N8N_DT_GSC_URL_INSPECTION_WEBHOOK fehlt). " +
      "Technische Indexierbarkeit kannst du weiter mit `audit_site_indexability` prüfen."
    );
  }

  const body: Record<string, unknown> = {
    organisationId: input.organisationId,
  };
  if (input.urls?.length) body.urls = input.urls.slice(0, 30);
  if (typeof input.limit === "number") body.limit = input.limit;

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return `URL-Inspection-Start fehlgeschlagen (${res.status}): ${text || "unbekannt"}`;
  }

  const count = input.urls?.length;
  return count
    ? `Google-URL-Inspection für ${count} URL(s) gestartet. In wenigen Minuten erneut \`read_index_status\` aufrufen.`
    : "Google-URL-Inspection-Stichprobe gestartet (URLs aus Sitemap/Crawl). In wenigen Minuten erneut `read_index_status` aufrufen.";
}
