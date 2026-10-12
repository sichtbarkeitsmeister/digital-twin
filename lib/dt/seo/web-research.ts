import type Anthropic from "@anthropic-ai/sdk";

/** Websuchen je KI-Antwort (10 $ je 1.000 Suchen → max. 0,10 $ pro Antwort). */
export const DT_WEB_SEARCH_MAX_USES = 10;
/** Web-Abrufe je KI-Antwort (kostenlos, nur Tokens). */
export const DT_WEB_FETCH_MAX_USES = 5;
/** Obergrenze für Seiteninhalt je Antwort, damit lange Seiten nicht den Kontext füllen. */
export const DT_WEB_FETCH_MAX_CONTENT_TOKENS = 30_000;

export const DT_WEB_SEARCH_LIMIT_NOTICE = `Hinweis: Das Limit von ${DT_WEB_SEARCH_MAX_USES} Websuchen pro Antwort ist erreicht, weitere Suchen waren in dieser Antwort nicht möglich. Für weitere Recherche bitte eine neue Nachricht schicken, dann stehen wieder ${DT_WEB_SEARCH_MAX_USES} Suchen zur Verfügung.`;

export const DT_WEB_FETCH_LIMIT_NOTICE = `Hinweis: Das Limit von ${DT_WEB_FETCH_MAX_USES} Web-Abrufen pro Antwort ist erreicht, weitere Seiten konnten in dieser Antwort nicht gelesen werden. Für weitere Abrufe bitte eine neue Nachricht schicken.`;

/** Anthropic server tools: Websuche + Web-Abruf (laufen bei Anthropic, kein eigener Loop). */
export const DT_WEB_RESEARCH_TOOLS: Anthropic.ToolUnion[] = [
  {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: DT_WEB_SEARCH_MAX_USES,
    user_location: { type: "approximate", country: "DE", timezone: "Europe/Berlin" },
  },
  {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: DT_WEB_FETCH_MAX_USES,
    max_content_tokens: DT_WEB_FETCH_MAX_CONTENT_TOKENS,
  },
];

export const DT_WEB_RESEARCH_INSTRUCTIONS = `
## Websuche und Web-Abruf
- Du hast \`web_search\` (Websuche) und \`web_fetch\` (eine konkrete URL vollständig lesen). Beides läuft außerhalb der Kundendomain; für Seiten der eigenen Website bleiben \`read_website_page\` und \`search_website_content\` zuständig.
- Suche gezielt, nicht routinemäßig. Sinnvolle Anlässe: Nachfrage nach einer Leistung oder Entität außerhalb der Avatare, Mitbewerber und was sie kommunizieren, aktuelle Version des Grounding Page Standards (groundingpage.com), Branchenrecht (z. B. HWG, BRAO), aktuelle Google- oder KI-Crawler-Vorgaben, Google-Bewertungen und Profile.
- Limit: höchstens ${DT_WEB_SEARCH_MAX_USES} Websuchen und ${DT_WEB_FETCH_MAX_USES} Web-Abrufe pro Antwort. Plane die Suchen vorher, formuliere präzise Suchanfragen und fasse Fragen zusammen, statt jede Variante einzeln zu suchen.
- Meldet ein Suchergebnis \`max_uses_exceeded\`, ist das Limit erreicht. Dann sagst du dem Nutzer ausdrücklich: Das Limit von ${DT_WEB_SEARCH_MAX_USES} Websuchen pro Antwort ist erreicht, weitere Suchen waren in dieser Antwort nicht möglich. Nenne, was du deshalb nicht prüfen konntest, und biete an, die restliche Recherche in einer neuen Nachricht fortzusetzen. Erfinde keine Ergebnisse für nicht ausgeführte Suchen.
- Nenne bei jedem Fakt aus dem Web die Quelle mit URL. Suchergebnisse sind Hinweise, keine Belege für Preise oder Produktnamen; diese kommen nur von der Zielseite selbst oder vom Nutzer.
- Interne Informationen des Kunden (Avatare, Transkripte, Onboarding) gehören nie in eine Suchanfrage.
`.trim();

export type DtWebResearchUsage = {
  webSearchRequests: number;
  webFetchRequests: number;
};

export function sumServerToolUsage(
  usage: { server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null } | null | undefined,
): DtWebResearchUsage {
  return {
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
    webFetchRequests: usage?.server_tool_use?.web_fetch_requests ?? 0,
  };
}

export function mergeWebResearchUsage(
  a: DtWebResearchUsage,
  b: DtWebResearchUsage,
): DtWebResearchUsage {
  return {
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  };
}

export type DtWebResearchFindings = {
  /** Websuche wurde wegen max_uses abgelehnt. */
  searchLimitHit: boolean;
  /** Web-Abruf wurde wegen max_uses abgelehnt. */
  fetchLimitHit: boolean;
  /** Eindeutige Quellen, die der Text zitiert (Reihenfolge der ersten Nennung). */
  sources: Array<{ url: string; title: string | null }>;
};

type LooseBlock = {
  type?: string;
  content?: unknown;
  citations?: unknown;
};

/**
 * Inspect response content blocks (across all tool rounds) for search/fetch
 * limit errors and cited web sources. Pure for tests.
 */
export function inspectWebResearchBlocks(blocks: unknown[]): DtWebResearchFindings {
  let searchLimitHit = false;
  let fetchLimitHit = false;
  const sources = new Map<string, string | null>();

  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as LooseBlock;

    if (block.type === "web_search_tool_result") {
      const content = block.content as { type?: string; error_code?: string } | undefined;
      if (
        content &&
        !Array.isArray(content) &&
        content.type === "web_search_tool_result_error" &&
        content.error_code === "max_uses_exceeded"
      ) {
        searchLimitHit = true;
      }
    } else if (block.type === "web_fetch_tool_result") {
      const content = block.content as { type?: string; error_code?: string } | undefined;
      if (content && content.type === "web_fetch_tool_result_error" && content.error_code === "max_uses_exceeded") {
        fetchLimitHit = true;
      }
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const citation of block.citations as Array<{ type?: string; url?: string; title?: string | null }>) {
        if (citation?.type !== "web_search_result_location" || !citation.url) continue;
        if (!sources.has(citation.url)) sources.set(citation.url, citation.title ?? null);
      }
    }
  }

  return {
    searchLimitHit,
    fetchLimitHit,
    sources: [...sources.entries()].map(([url, title]) => ({ url, title })),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Append the deterministic limit notice and a source list to the assistant text.
 * The notice is added even when the model already mentioned the limit in its own
 * words, so the user always sees the exact statement.
 */
export function appendWebResearchNotes(text: string, findings: DtWebResearchFindings): string {
  const parts = [text.trim()];

  if (findings.sources.length > 0) {
    const alreadyListed = /(^|\n)\s*(\*\*)?Quellen(\*\*)?\s*:?\s*(\n|$)/i.test(text);
    if (!alreadyListed) {
      const lines = findings.sources.slice(0, 12).map((s) => {
        const label = s.title?.trim() || hostOf(s.url);
        return `- [${label}](${s.url})`;
      });
      parts.push(`**Quellen (Websuche):**\n${lines.join("\n")}`);
    }
  }

  if (findings.searchLimitHit) parts.push(DT_WEB_SEARCH_LIMIT_NOTICE);
  if (findings.fetchLimitHit) parts.push(DT_WEB_FETCH_LIMIT_NOTICE);

  return parts.filter(Boolean).join("\n\n");
}
