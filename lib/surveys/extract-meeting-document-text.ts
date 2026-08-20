/**
 * Extract readable text from meeting-summary uploads (txt/md/docx/pdf).
 * Testable for plain text; Word uses mammoth; PDF uses pdftotext if available.
 */

export const MEETING_DOC_TEXT_MAX = 40_000;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function looksLikeDocx(fileName: string, mimeType: string): boolean {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  return (
    name.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function looksLikePdf(fileName: string, mimeType: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf") || mimeType.toLowerCase().includes("pdf");
}

function looksLikePlainText(fileName: string, mimeType: string): boolean {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    mime.startsWith("text/") ||
    mime === "application/json"
  );
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return (result.value ?? "").replace(/\r\n/g, "\n").trim();
}

function extractPdfViaPdftotext(bytes: Uint8Array): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const result = spawnSync("pdftotext", ["-layout", "-", "-"], {
      input: Buffer.from(bytes),
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
    });
    if (result.status !== 0) return null;
    const text = (result.stdout ?? "").trim();
    return text.length >= 20 ? text : null;
  } catch {
    return null;
  }
}

export function extractMeetingDocumentText(input: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): { ok: true; text: string } | { ok: false; message: string } {
  const name = input.fileName.toLowerCase();
  if (name.endsWith(".doc") && !name.endsWith(".docx")) {
    return {
      ok: false,
      message: "Altes Word-Format (.doc) wird nicht gelesen. Bitte als .docx oder PDF speichern.",
    };
  }

  if (looksLikePlainText(input.fileName, input.mimeType)) {
    const text = decodeUtf8(input.bytes).trim();
    if (!text) return { ok: false, message: "Die Textdatei ist leer." };
    return { ok: true, text: text.slice(0, MEETING_DOC_TEXT_MAX) };
  }

  if (looksLikePdf(input.fileName, input.mimeType)) {
    const fromBin = extractPdfViaPdftotext(input.bytes);
    if (fromBin) return { ok: true, text: fromBin.slice(0, MEETING_DOC_TEXT_MAX) };
    return {
      ok: false,
      message:
        "PDF gespeichert, Text konnte lokal nicht gelesen werden. Bitte zusätzlich .docx oder .txt hochladen, oder pdftotext auf dem Server bereitstellen.",
    };
  }

  return {
    ok: false,
    message: "Dieser Dateityp wird nicht unterstützt. Bitte PDF, Word (.docx) oder Textdatei.",
  };
}

export async function extractMeetingDocumentTextAsync(input: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  if (looksLikeDocx(input.fileName, input.mimeType)) {
    try {
      const text = await extractDocxText(input.bytes);
      if (!text) return { ok: false, message: "Die Word-Datei enthält keinen lesbaren Text." };
      return { ok: true, text: text.slice(0, MEETING_DOC_TEXT_MAX) };
    } catch {
      return { ok: false, message: "Word-Datei konnte nicht gelesen werden." };
    }
  }

  if (looksLikePdf(input.fileName, input.mimeType)) {
    const local = extractPdfViaPdftotext(input.bytes);
    if (local) return { ok: true, text: local.slice(0, MEETING_DOC_TEXT_MAX) };
    const fromAi = await extractPdfTextWithAnthropic(input.bytes);
    if (fromAi) return { ok: true, text: fromAi.slice(0, MEETING_DOC_TEXT_MAX) };
    return {
      ok: false,
      message:
        "PDF gespeichert, Text konnte nicht gelesen werden. Bitte zusätzlich .docx oder .txt hochladen.",
    };
  }

  return extractMeetingDocumentText(input);
}

async function extractPdfTextWithAnthropic(bytes: Uint8Array): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { callAnthropicFirstAvailable, extractAnthropicText } = await import(
      "@/lib/ai/anthropic-helpers"
    );
    const { DEFAULT_SURVEY_ACTION_MODEL } = await import("@/lib/ai/survey-model-config");
    const anthropic = new Anthropic({ apiKey });
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: [DEFAULT_SURVEY_ACTION_MODEL],
      maxTokens: 4000,
      timeoutMs: 50_000,
      stream: false,
      system: "Extrahiere den vollständigen sichtbaren Text. Keine Zusammenfassung. Nur den Text.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: Buffer.from(bytes).toString("base64"),
              },
            },
            {
              type: "text",
              text: "Bitte den Dokumenttext vollständig extrahieren.",
            },
          ],
        },
      ],
    });
    if (!result) return null;
    const text = extractAnthropicText(result.response).trim();
    return text.length >= 20 ? text : null;
  } catch {
    return null;
  }
}
