import {
  DT_SEO_MODE_INSTRUCTIONS,
  formatDtSitePagesForPrompt,
} from "@/lib/dt/seo/build-seo-context";
import { buildDtChatStaticSystemText } from "@/lib/dt/prompts/system-static";
import { PASTED_URL_PROMPT_HINT_DE } from "@/lib/shared/pasted-url-context";
import { buildDtGeoGroundingText } from "@/lib/dt/prompts/geo-grounding";
import { formatSeoChecklist } from "@/lib/dt/seo/seo-checklist";
import type { DtSitePageRow } from "@/lib/dt/types";

export type DtPromptAgent = {
  name: string;
  role: string | null;
  prompt_template: string;
  prompt_append?: string | null;
  kind?: string;
};

export type DtPromptOrg = {
  display_name: string;
  website_url?: string | null;
  focus_keyword?: string | null;
  seo_checklist?: unknown;
  sitemap_url?: string | null;
};

export function buildDtSystemPrompt(input: {
  agent: DtPromptAgent;
  org: DtPromptOrg;
  mode: "default" | "seo" | "team" | "ghost";
  globalRules?: string;
  ghostMode?: boolean;
  sitePages?: DtSitePageRow[];
  latestSeoReportText?: string;
  monthlyStatsText?: string;
  seoTasksText?: string;
  /** Digest of other SEO chats in the same organisation (cross-chat memory). */
  otherSeoChatsText?: string;
  pastedUrlsText?: string;
  textMode?: boolean;
}): string {
  const blocks = [
    buildDtChatStaticSystemText(),
    "",
    `## Identität`,
    `Du bist ${input.agent.name}${input.agent.role ? ` (${input.agent.role})` : ""}.`,
    `Organisation: ${input.org.display_name}.`,
    input.org.website_url ? `Website: ${input.org.website_url}.` : "",
    input.org.focus_keyword ? `Fokus-Keyword: ${input.org.focus_keyword}.` : "",
    "",
    `## Persona-Anweisungen`,
    input.agent.prompt_template.trim(),
  ];

  if (input.agent.prompt_append?.trim()) {
    blocks.push("", "## Zusätzliche Anweisungen", input.agent.prompt_append.trim());
  }

  if (input.globalRules?.trim()) {
    blocks.push("", "## Zusätzliche Nutzerregeln", input.globalRules.trim());
  }

  blocks.push("", PASTED_URL_PROMPT_HINT_DE);

  if (input.mode === "seo" || input.agent.kind === "geo_advisor") {
    blocks.push("", buildDtGeoGroundingText());
    const checklist = formatSeoChecklist(input.org.seo_checklist);
    if (checklist) blocks.push("", "## SEO-Checkliste", checklist);
    if (input.org.sitemap_url) {
      blocks.push("", `Sitemap: ${input.org.sitemap_url}`);
    }
    if (input.mode === "seo") {
      blocks.push("", DT_SEO_MODE_INSTRUCTIONS);
      blocks.push(
        "",
        "## Prüfbare Unterseiten",
        formatDtSitePagesForPrompt(input.sitePages ?? []),
      );
      blocks.push(
        "",
        "## Letzter SEO-Report",
        input.latestSeoReportText?.trim() ||
          "Kein abgeschlossener SEO-Report geladen.",
      );
      blocks.push(
        "",
        "## Monatliche SEO-Trends",
        input.monthlyStatsText?.trim() ||
          "Keine monatlichen SEO-Statistiken hinterlegt.",
      );
      blocks.push(
        "",
        "## Bestehende SEO-Aufgaben",
        input.seoTasksText?.trim() ||
          "Keine Aufgabenliste geladen — vor Task-Empfehlungen kurz prüfen, ob der Nutzer schon Aufgaben im Board hat.",
      );
      blocks.push(
        "",
        "## Andere SEO-Chats dieser Organisation",
        input.otherSeoChatsText?.trim() ||
          "Keine weiteren SEO-Chat-Auszüge geladen.",
      );
    }
  }

  if (input.mode === "team") {
    blocks.push(
      "",
      "## Team-Modus",
      "Mehrere Teammitglieder nutzen diesen Chat. Beachte, wer gesprochen hat, wenn Namen im Verlauf stehen.",
    );
  }

  if (input.mode === "ghost" || input.ghostMode) {
    blocks.push("", "## Ghost-Modus", "Diese Konversation wird nicht dauerhaft gespeichert.");
  }

  if (input.textMode) {
    blocks.push(
      "",
      "## Text-Modus",
      "Der Nutzer möchte SEO-optimierte, publikationsreife Texte — kein Chat, sondern fertiger Copy-Output.",
      "",
      "### SEO",
      "- Fokus-Keyword und semantische Varianten natürlich einweben (Titel, erster Absatz, H2/H3).",
      "- Suchintention treffen; scannbare Struktur mit klaren Zwischenüberschriften.",
      "- Bei Bedarf Meta-Titel, Meta-Description und interne Verlinkungsvorschläge klar getrennt anbieten.",
      "- Kein Keyword-Stuffing, keine künstliche Wiederholung.",
      "",
      "### Menschlicher Ton (Anti-AI-Slop)",
      "- Satzlängen und Rhythmus variieren; aktiv formulieren, konkrete Details statt Füllwörter.",
      "- Vermeide Floskeln wie „in der heutigen schnelllebigen Welt“, „darüber hinaus“, „zudem“, „es ist wichtig zu beachten“.",
      "- Kein leerer Schlussabsatz, kein Em-Dash-Overuse, natürliches Deutsch.",
      "",
      "### Output",
      "- Liefere den fertigen Text zum direkten Einfügen.",
      "- Meta-/Titel-Vorschläge klar abtrennen, wenn du sie mitlieferst.",
    );
  }

  if (input.pastedUrlsText?.trim()) {
    blocks.push("", "## Eingefügte Webseiten", input.pastedUrlsText.trim());
  }

  return blocks.filter(Boolean).join("\n");
}
