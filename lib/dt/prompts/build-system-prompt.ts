import {
  DT_SEO_MODE_INSTRUCTIONS,
  formatDtSitePagesForPrompt,
} from "@/lib/dt/seo/build-seo-context";
import { buildDtChatStaticSystemText } from "@/lib/dt/prompts/system-static";
import { PASTED_URL_PROMPT_HINT_DE } from "@/lib/shared/pasted-url-context";
import { buildDtGeoGroundingText } from "@/lib/dt/prompts/geo-grounding";
import type { DtSitePageRow } from "@/lib/dt/types";

export type DtPromptAgent = {
  name: string;
  role: string | null;
  prompt_template: string;
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
  pastedUrlsText?: string;
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

  if (input.globalRules?.trim()) {
    blocks.push("", "## Zusätzliche Nutzerregeln", input.globalRules.trim());
  }

  if (input.mode === "seo" || input.agent.kind === "geo_advisor") {
    blocks.push("", buildDtGeoGroundingText());
    const checklist = formatSeoChecklist(input.org.seo_checklist);
    if (checklist) blocks.push("", "## SEO-Checkliste", checklist);
    if (input.org.sitemap_url) {
      blocks.push("", `Sitemap: ${input.org.sitemap_url}`);
    }
    if (input.mode === "seo") {
      blocks.push("", DT_SEO_MODE_INSTRUCTIONS);
      blocks.push("", PASTED_URL_PROMPT_HINT_DE);
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
      if (input.pastedUrlsText?.trim()) {
        blocks.push("", "## Eingefügte Webseiten", input.pastedUrlsText.trim());
      }
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

  return blocks.filter(Boolean).join("\n");
}

function formatSeoChecklist(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "";
  return raw
    .map((item, i) => {
      if (typeof item === "string") return `${i + 1}. ${item}`;
      if (item && typeof item === "object" && "label" in item) {
        const label = String((item as { label?: unknown }).label ?? "").trim();
        if (label) return `${i + 1}. ${label}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
