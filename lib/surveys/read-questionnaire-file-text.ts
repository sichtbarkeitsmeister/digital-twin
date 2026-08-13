/**
 * Extract plain text from uploaded questionnaire files (.txt / .md / .docx).
 * Runs in the browser so Word docs can be imported without a server round-trip.
 */

import {
  pickBestDocxExtraction,
  questionnaireHtmlToImportText,
} from "@/lib/surveys/docx-questionnaire-html";

function isDocxFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return true;
  return (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/msword"
  );
}

function isPlainTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) {
    return true;
  }
  return (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    file.type === ""
  );
}

type MammothBrowser = {
  convertToHtml: (input: {
    arrayBuffer: ArrayBuffer;
  }) => Promise<{ value: string }>;
  extractRawText: (input: {
    arrayBuffer: ArrayBuffer;
  }) => Promise<{ value: string }>;
};

async function loadMammoth(): Promise<MammothBrowser> {
  const mod = (await import("mammoth/mammoth.browser")) as MammothBrowser & {
    default?: MammothBrowser;
  };
  return mod.default ?? mod;
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  if (!arrayBuffer.byteLength) {
    throw new Error(
      `„${file.name}“ ist leer oder noch nicht vollständig geladen (SeaDrive: Datei erst lokal öffnen/syncen).`,
    );
  }

  const [htmlResult, rawResult] = await Promise.all([
    mammoth.convertToHtml({ arrayBuffer }).catch(() => ({ value: "" })),
    mammoth.extractRawText({ arrayBuffer }).catch(() => ({ value: "" })),
  ]);

  const fromHtml = questionnaireHtmlToImportText(htmlResult.value ?? "");
  const fromRaw = (rawResult.value ?? "").replace(/\r\n/g, "\n").trim();
  const text = pickBestDocxExtraction({ htmlText: fromHtml, rawText: fromRaw });

  if (!text) {
    throw new Error(`„${file.name}“ enthält keinen lesbaren Text.`);
  }
  return text;
}

export async function readQuestionnaireFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc") && !name.endsWith(".docx")) {
    throw new Error(
      `„${file.name}“ ist altes Word-Format (.doc). Bitte als .docx speichern oder Text kopieren.`,
    );
  }
  if (isDocxFile(file)) {
    const { normalizeWordQuestionnaireText } = await import(
      "@/lib/surveys/raw-filled-questionnaire-chunks"
    );
    const text = await extractDocxText(file);
    return normalizeWordQuestionnaireText(text);
  }
  if (isPlainTextFile(file) || name.endsWith(".json")) {
    const text = (await file.text()).trim();
    if (!text) {
      throw new Error(`„${file.name}“ ist leer.`);
    }
    return text;
  }
  throw new Error(
    `„${file.name}“ wird nicht unterstützt. Bitte .docx, .txt oder .md verwenden.`,
  );
}

export const QUESTIONNAIRE_FILE_ACCEPT =
  ".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
