import { isBlockedFetchHost } from "@/lib/shared/safe-fetch-url";
import { decodeResponseTextSafely, sanitizeForLlmText } from "@/lib/shared/sanitize-llm-text";

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_URLS = 2;
const MAX_TEXT_CHARS = 6_000;

function cleanTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/g, "");
}

export function extractUrlsFromText(text: string, max = MAX_URLS): string[] {
  const matches = text.match(URL_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const cleaned = cleanTrailingPunctuation(raw.trim());
    try {
      const url = new URL(cleaned);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (isBlockedFetchHost(url.hostname)) continue;
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      continue;
    }
    if (out.length >= max) break;
  }

  return out;
}

function htmlToPlainText(html: string): string {
  return sanitizeForLlmText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_CHARS),
  );
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return sanitizeForLlmText(match[1].replace(/\s+/g, " ").trim()) || null;
}

async function fetchPublicPage(url: string): Promise<{ title: string | null; text: string } | null> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "DigitalTwinBot/1.0 (+https://digital-twin-sbkm.de)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const body = decodeResponseTextSafely(await res.arrayBuffer());

  const looksLikeXml =
    contentType.includes("xml") ||
    url.toLowerCase().includes("sitemap") ||
    /^\s*<\?xml/i.test(body) ||
    /<(urlset|sitemapindex)\b/i.test(body);

  if (looksLikeXml) {
    const locs = [...body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
    const unique = [...new Set(locs)];
    if (unique.length === 0) {
      return {
        title: "Sitemap/XML",
        text: body.slice(0, MAX_TEXT_CHARS),
      };
    }
    const preview = unique.slice(0, 60);
    const text = [
      `Sitemap/XML mit ${unique.length} <loc>-Einträgen.`,
      "URLs (Auszug):",
      ...preview.map((u, i) => `${i + 1}. ${u}`),
      unique.length > preview.length ? `… und ${unique.length - preview.length} weitere.` : null,
      "",
      "Für den vollständigen Sitemap-Abgleich im SEO-Modus zusätzlich `read_sitemap` nutzen.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_CHARS);
    return { title: "Sitemap", text };
  }

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/xhtml")
  ) {
    return null;
  }

  const text = htmlToPlainText(body);
  if (!text) return null;

  return {
    title: extractHtmlTitle(body),
    text,
  };
}

export async function buildPastedUrlContextText(sourceText: string): Promise<string | null> {
  const urls = extractUrlsFromText(sourceText);
  if (urls.length === 0) return null;

  const sections: string[] = [];

  for (const url of urls) {
    try {
      const page = await fetchPublicPage(url);
      if (!page) {
        sections.push(
          `URL: ${url}\nStatus: Seite konnte nicht geladen werden (nicht öffentlich, blockiert oder ungeeigneter Inhaltstyp).`,
        );
        continue;
      }

      sections.push(
        [
          `URL: ${url}`,
          page.title ? `Titel: ${page.title}` : null,
          "Sichtbarer Seiteninhalt (Auszug):",
          page.text,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch {
      sections.push(`URL: ${url}\nStatus: Abruf fehlgeschlagen (Timeout oder Netzwerkfehler).`);
    }
  }

  return sections.join("\n\n---\n\n");
}

export const PASTED_URL_PROMPT_HINT_DE = [
  "## Eingefügte Webseiten-URLs",
  "Wenn der Nutzer http(s)-Links in die Nachricht einfügt, lädt das System den öffentlich sichtbaren Seiteninhalt automatisch.",
  "Du findest den Inhalt im Abschnitt „Eingefügte Webseiten“ — nutze ihn für Analyse und konkrete Empfehlungen.",
  "Behaupte nicht, eine Seite gesehen zu haben, wenn dort kein geladener Inhalt steht oder das Laden fehlgeschlagen ist.",
].join("\n");

export const PASTED_URL_PROMPT_HINT_EN = [
  "## Pasted website URLs",
  "When the user includes http(s) links in a message, the system automatically fetches publicly visible page content.",
  "Use the section \"Pasted website content\" for analysis and concrete suggestions.",
  "Do not claim you viewed a page unless fetched content for that URL is present.",
].join("\n");
