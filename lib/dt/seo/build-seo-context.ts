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
  limit = 40,
): Promise<DtSitePageRow[]> {
  const { data } = await supabase
    .from("dt_site_pages")
    .select("id,organisation_id,url,title,h1,meta_description,is_excluded,crawled_at")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .order("url", { ascending: true })
    .limit(limit);

  return (data ?? []) as DtSitePageRow[];
}

export function formatDtSitePagesForPrompt(pages: DtSitePageRow[]): string {
  if (pages.length === 0) {
    return "Noch keine Unterseiten gecrawlt. Bitte den Nutzer fragen, welche URL analysiert werden soll, oder einen SEO-Report auslösen (crawlt die Sitemap).";
  }
  return pages
    .map((p, i) => {
      const label = p.title?.trim() || p.h1?.trim() || p.url;
      return `${i + 1}. ${label} — ${p.url}`;
    })
    .join("\n");
}

export const DT_SEO_MODE_INSTRUCTIONS = `
## SEO-Modus — Verhaltensregeln
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
