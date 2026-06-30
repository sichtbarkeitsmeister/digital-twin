import type { SupabaseClient } from "@supabase/supabase-js";

import type { DtSitePageRow } from "@/lib/dt/types";

const EXCLUDED_PATH =
  /\/(impressum|datenschutz|agb|widerruf|privacy|legal)(\/|$)/i;

export function isDtExcludedPageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return EXCLUDED_PATH.test(path);
  } catch {
    return EXCLUDED_PATH.test(url);
  }
}

export async function loadDtSitePagesForPrompt(
  supabase: SupabaseClient,
  organisationId: string,
  limit = 200,
): Promise<DtSitePageRow[]> {
  // Index only: deliberately do NOT select text_content here. The full page
  // text lives in the DB and is pulled into the LLM context on demand via the
  // retrieval tools (search_website_content / read_website_page), so we never
  // dump full bodies into every prompt.
  const { data } = await supabase
    .from("dt_site_pages")
    .select("id,organisation_id,url,title,h1,meta_description,is_excluded,crawled_at")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .order("url", { ascending: true })
    .limit(limit);

  return (data ?? []) as DtSitePageRow[];
}

/** Max chars kept from a page title in the compact prompt index. */
const SITE_PAGE_TITLE_LIMIT = 120;

export function formatDtSitePagesForPrompt(pages: DtSitePageRow[]): string {
  if (pages.length === 0) {
    return "Noch keine Unterseiten gecrawlt. Bitte den Nutzer fragen, welche URL analysiert werden soll, oder in den SEO-Einstellungen „Jetzt crawlen“ ausführen.";
  }
  const header =
    "Kompakter Index der gecrawlten Unterseiten (nur Titel + URL). Titel, H1, Meta und der VOLLE Seitentext sind NICHT hier — hole sie bei Bedarf mit den Werkzeugen `search_website_content` (Stichwortsuche über alle Seiten) oder `read_website_page` (vollständiger Inhalt einer URL). Lade Inhalte nur, wenn du sie für die Antwort wirklich brauchst.";
  const list = pages
    .map((p, i) => {
      const rawLabel = p.title?.trim() || p.h1?.trim() || "";
      const label =
        rawLabel.length > SITE_PAGE_TITLE_LIMIT
          ? `${rawLabel.slice(0, SITE_PAGE_TITLE_LIMIT - 1).trimEnd()}…`
          : rawLabel;
      return label && label !== p.url
        ? `${i + 1}. ${label} — ${p.url}`
        : `${i + 1}. ${p.url}`;
    })
    .join("\n");
  return `${header}\n\n${list}`;
}

export const DT_SEO_MODE_INSTRUCTIONS = `
## SEO-Modus — Verhaltensregeln
- Der VOLLE Seitentext steht NICHT im Prompt. Unter „Prüfbare Unterseiten“ findest du nur einen Index (Titel/Meta). Wenn du den tatsächlichen Inhalt einer Seite brauchst, hole ihn gezielt: \`search_website_content\` für eine Stichwortsuche über alle Seiten, \`read_website_page\` für den vollständigen Text einer bestimmten URL. Lade nur, was du wirklich brauchst — rate nicht über Inhalte, prüfe sie.
- Bevor du konkrete Verbesserungen vorschlägst, fasse die Ist-Situation kurz zusammen und frage: „Passt diese Zusammenfassung?“ Erst nach Bestätigung oder Korrektur mit Maßnahmen fortfahren.
- Wenn keine Unterseite genannt ist, frage ausdrücklich, auf welche Seite du dich konzentrieren sollst, und biete die Liste der prüfbaren Unterseiten an.
- Impressum, Datenschutz und rechtliche Seiten sind ausgeschlossen — nicht optimieren.
- Nutze den Abschnitt „Letzter SEO-Report“ für aktuelle Rankings, Keywords und Report-Empfehlungen; monatliche Trends nur für Verlaufsfragen.
- Nutze die Liste „Bestehende SEO-Aufgaben“ unten: wiederhole keine Maßnahmen, die dort schon offen oder in Arbeit sind. Sage nicht, der Nutzer solle etwas als Aufgabe speichern, wenn es bereits im Board steht.

## Aufgaben-Vorschläge (SEO-Board)
Nur wenn du 1–6 konkrete, neue SEO-Maßnahmen vorschlägst, die der Nutzer ins Aufgaben-Board übernehmen soll:
- Schreibe zuerst die sichtbare Erklärung (Tabelle oder Liste).
- Hänge am ENDE genau einen Block an (wird im Chat ausgeblendet, aber zum Speichern genutzt):

\`\`\`dt-tasks
[{"title":"Kurzer Titel","keyword":"…","url":"https://…","current_status":"Pos. X / Y Impr.","action":"Konkrete Schritte","priority":"high"}]
\`\`\`

Regeln für den Block:
- NUR bei echten, speicherbaren Aufgaben — nicht bei Smalltalk, reinen Zusammenfassungen ohne Maßnahmen, oder wenn alles schon im Board steht.
- Jede Aufgabe braucht: title, action, und mindestens keyword oder url.
- current_status wenn aus Daten bekannt (Ranking, Impressionen).
- priority nur bei klarer Dringlichkeit (high/medium/low), sonst weglassen.
- Maximal 6 Aufgaben pro Antwort.
`.trim();
