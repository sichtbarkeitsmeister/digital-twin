/**
 * The input of a text-tool run (SEO, GEO, Hormozi): either an uploaded file (`file`) or a
 * page of the crawled website (`crawlUrl`). Both end as the same document and blocks, so the
 * tools themselves do not care where the text came from. Server only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCrawledPageInput } from "@/lib/dt/text-tools/crawl-source";
import {
  TEXT_TOOL_MAX_FILE_BYTES,
  blocksFromDocument,
  extractUploadedDocument,
  type IngestedText,
  type UploadedDocument,
} from "@/lib/dt/text-tools/ingest";

export type TextToolInput = {
  /** The upload's name, or a file-like name for a crawled page („leistungen-dach.html“). */
  fileName: string;
  /** The crawled page's own name (H1/title); null for an upload. */
  crawledPageName: string | null;
  /** `file`: upload; `live`: crawled page fetched now; `crawl`: stored crawl text. */
  source: "file" | "live" | "crawl";
  url: string | null;
  document: UploadedDocument;
  ingested: IngestedText;
};

export type TextToolInputResult = { ok: true; value: TextToolInput | null } | { ok: false; message: string };

export const TEXT_TOOL_MISSING_INPUT_MESSAGE =
  "Bitte eine Datei hochladen (.txt, .html, .pdf oder .docx) oder eine Seite aus dem Crawl wählen.";

/** Reads `crawlUrl` or `file` from the form; `value: null` when neither was sent. */
export async function readTextToolInput(form: FormData, service: SupabaseClient, organisationId: string): Promise<TextToolInputResult> {
  const crawlUrl = form.get("crawlUrl");
  if (typeof crawlUrl === "string" && crawlUrl.trim()) {
    const page = await loadCrawledPageInput(service, organisationId, crawlUrl.trim().slice(0, 2_000));
    if (!page.ok) return page;
    const { fileName, pageName, source, url, document, ingested } = page.value;
    return { ok: true, value: { fileName, crawledPageName: pageName, source, url, document, ingested } };
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: true, value: null };
  if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return { ok: false, message: `„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).` };
  }
  const document = await extractUploadedDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!document.ok) return document;
  const ingested = blocksFromDocument(document.value);
  if (!ingested.ok) return ingested;
  return {
    ok: true,
    value: { fileName: file.name.slice(0, 260), crawledPageName: null, source: "file", url: null, document: document.value, ingested: ingested.value },
  };
}
