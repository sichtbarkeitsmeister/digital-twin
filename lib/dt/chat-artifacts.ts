import { z } from "zod";

export const DT_CHAT_ARTIFACT_MAX_COUNT = 4;
export const DT_CHAT_ARTIFACT_MAX_CHARS = 100_000;

export const DT_CHAT_ARTIFACT_MIME_BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  css: "text/css",
  xml: "application/xml",
};

const ALLOWED_MIME = new Set(Object.values(DT_CHAT_ARTIFACT_MIME_BY_EXT));

const artifactSchema = z.object({
  filename: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().min(1).max(80),
  content: z.string().min(1).max(DT_CHAT_ARTIFACT_MAX_CHARS),
  title: z.string().trim().max(200).nullable().optional(),
});

export type DtChatArtifact = z.infer<typeof artifactSchema>;

const FENCE_RE = /(?:```|~~~)([^\n]*)\n([\s\S]*?)(?:```|~~~)/g;

/** Strip BOM, NUL, and other C0 controls that break JSON/Postgres. */
export function sanitizeDtChatArtifactText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function dtChatArtifactByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

export function isDtChatHtmlMime(mimeType: string): boolean {
  return mimeType.trim().toLowerCase().startsWith("text/html");
}

export function looksLikeHtmlDocument(text: string): boolean {
  const t = text.trim();
  if (t.length < 280) return false;
  return /<!DOCTYPE\s+html/i.test(t) || /<html[\s>]/i.test(t);
}

function extOf(filename: string): string {
  const match = filename.trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] ?? "";
}

function mimeFromFilename(filename: string): string | null {
  const mime = DT_CHAT_ARTIFACT_MIME_BY_EXT[extOf(filename)];
  return mime ?? null;
}

function normalizeMime(raw: string | null | undefined, filename: string): string | null {
  const fromName = mimeFromFilename(filename);
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return fromName;
  const base = trimmed.split(";")[0]?.trim() ?? "";
  if (base === "text/xml") return "application/xml";
  if (ALLOWED_MIME.has(base)) return base;
  if (fromName) return fromName;
  return null;
}

export function sanitizeDtChatArtifactFilename(
  raw: string,
  fallbackExt: string,
): string {
  const base = raw.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  let name = sanitizeDtChatArtifactText(base)
    .replace(/[^\w.\-äöüÄÖÜß]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.$/, "");
  if (!name) name = "datei";
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
    const ext = fallbackExt.startsWith(".") ? fallbackExt : `.${fallbackExt}`;
    name += ext;
  }
  return name.slice(0, 120);
}

function filenameFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  if (title) return sanitizeDtChatArtifactFilename(title, ".html");
  return "prototyp.html";
}

function parseFenceInfo(info: string): { lang: string; filename?: string } {
  const trimmed = info.trim();
  if (!trimmed) return { lang: "" };

  const filenameAttr = trimmed.match(/filename\s*=\s*["']([^"']+)["']/i);
  const langToken = trimmed.split(/\s+/)[0] ?? "";
  const lang = langToken.replace(/^language-/, "").toLowerCase();

  if (filenameAttr?.[1]) {
    return { lang, filename: filenameAttr[1].trim() };
  }

  const colon = trimmed.match(/^([A-Za-z0-9_+-]+)\s*:\s*(.+)$/);
  if (colon?.[2] && /\.[a-z0-9]{1,8}$/i.test(colon[2].trim())) {
    return { lang: colon[1].toLowerCase(), filename: colon[2].trim() };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const maybeFile = parts.slice(1).find((part) => /\.[a-z0-9]{1,8}$/i.test(part));
  if (maybeFile) return { lang, filename: maybeFile };

  return { lang };
}

function isTaskFenceLang(lang: string): boolean {
  return lang === "dt-tasks" || lang === "json:dt-tasks";
}

function isArtifactFenceLang(lang: string): boolean {
  return lang === "dt-artifact" || lang === "json:dt-artifact" || lang === "artifact";
}

function parseHeaderBody(
  body: string,
  fallbackFilename: string | undefined,
  fallbackMime: string | undefined,
): DtChatArtifact | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const headers: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      break;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (!match) break;
    headers[match[1].toLowerCase()] = match[2].trim();
    i += 1;
  }
  const content = sanitizeDtChatArtifactText(lines.slice(i).join("\n")).trim();
  if (!content) return null;

  const rawName =
    headers.filename ||
    headers.file ||
    headers.name ||
    fallbackFilename ||
    (looksLikeHtmlDocument(content) ? filenameFromHtml(content) : "datei.txt");
  const mime = normalizeMime(
    headers.mimetype || headers.mime || headers.type || fallbackMime,
    rawName,
  );
  if (!mime) return null;
  const filename = sanitizeDtChatArtifactFilename(
    rawName,
    mime === "text/html" ? ".html" : `.${extOf(rawName) || "txt"}`,
  );
  const title = headers.title?.trim() || null;
  return normalizeArtifact({ filename, mimeType: mime, content, title });
}

function parseJsonArtifacts(raw: unknown): DtChatArtifact[] {
  const items = Array.isArray(raw) ? raw : [raw];
  const out: DtChatArtifact[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const content =
      typeof o.content === "string"
        ? o.content
        : typeof o.body === "string"
          ? o.body
          : typeof o.html === "string"
            ? o.html
            : "";
    const filename =
      typeof o.filename === "string"
        ? o.filename
        : typeof o.fileName === "string"
          ? o.fileName
          : typeof o.name === "string"
            ? o.name
            : "";
    const mimeRaw =
      typeof o.mimeType === "string"
        ? o.mimeType
        : typeof o.mime === "string"
          ? o.mime
          : typeof o.type === "string"
            ? o.type
            : undefined;
    const title = typeof o.title === "string" ? o.title : null;
    const mime = normalizeMime(mimeRaw, filename || "datei.txt");
    if (!mime || !content.trim()) continue;
    const normalized = normalizeArtifact({
      filename: sanitizeDtChatArtifactFilename(
        filename || (mime === "text/html" ? filenameFromHtml(content) : "datei.txt"),
        mime === "text/html" ? ".html" : ".txt",
      ),
      mimeType: mime,
      content: sanitizeDtChatArtifactText(content).trim(),
      title,
    });
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeArtifact(raw: {
  filename: string;
  mimeType: string;
  content: string;
  title?: string | null;
}): DtChatArtifact | null {
  const parsed = artifactSchema.safeParse({
    filename: raw.filename,
    mimeType: raw.mimeType,
    content: sanitizeDtChatArtifactText(raw.content).trim(),
    title: raw.title?.trim() || null,
  });
  if (!parsed.success) return null;
  if (!ALLOWED_MIME.has(parsed.data.mimeType)) return null;
  return parsed.data;
}

function artifactsFromFence(info: string, body: string): DtChatArtifact[] {
  const { lang, filename: infoFilename } = parseFenceInfo(info);
  if (isTaskFenceLang(lang)) return [];

  const trimmed = sanitizeDtChatArtifactText(body).replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];

  if (isArtifactFenceLang(lang)) {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return parseJsonArtifacts(JSON.parse(trimmed) as unknown);
      } catch {
        // Fall through to header/body parsing.
      }
    }
    const fallbackMime = infoFilename ? mimeFromFilename(infoFilename) ?? undefined : undefined;
    const parsed = parseHeaderBody(trimmed, infoFilename, fallbackMime);
    return parsed ? [parsed] : [];
  }

  const langMime = DT_CHAT_ARTIFACT_MIME_BY_EXT[lang];
  if (infoFilename && langMime) {
    const mime = normalizeMime(langMime, infoFilename);
    if (!mime) return [];
    if (mime === "text/html" && !looksLikeHtmlDocument(trimmed) && trimmed.length < 800) {
      return [];
    }
    const parsed = normalizeArtifact({
      filename: sanitizeDtChatArtifactFilename(infoFilename, `.${extOf(infoFilename) || lang}`),
      mimeType: mime,
      content: trimmed,
    });
    return parsed ? [parsed] : [];
  }

  if ((lang === "html" || lang === "htm") && looksLikeHtmlDocument(trimmed)) {
    const parsed = normalizeArtifact({
      filename: sanitizeDtChatArtifactFilename(
        infoFilename || filenameFromHtml(trimmed),
        ".html",
      ),
      mimeType: "text/html",
      content: trimmed,
    });
    return parsed ? [parsed] : [];
  }

  return [];
}

type CollectedFences = {
  artifacts: DtChatArtifact[];
  ranges: Array<{ start: number; end: number }>;
};

function collectArtifactFences(text: string): CollectedFences {
  const artifacts: DtChatArtifact[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();
  const re = new RegExp(FENCE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const fromFence = artifactsFromFence(match[1] ?? "", match[2] ?? "");
    if (fromFence.length === 0) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
    for (const artifact of fromFence) {
      const key = `${artifact.filename}\n${artifact.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      artifacts.push(artifact);
    }
  }
  return {
    artifacts: artifacts.slice(0, DT_CHAT_ARTIFACT_MAX_COUNT),
    ranges,
  };
}

export function parseDtChatArtifactsFromText(text: string): DtChatArtifact[] {
  return collectArtifactFences(text).artifacts;
}

export function stripDtChatArtifactBlocks(text: string): string {
  const { ranges } = collectArtifactFences(text);
  if (ranges.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    cursor = range.end;
  }
  out += text.slice(cursor);
  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function extractDtChatArtifactsFromMessage(input: {
  content: string;
  metadata?: Record<string, unknown> | null;
}): DtChatArtifact[] {
  const rawMeta = input.metadata?.chat_artifacts;
  if (Array.isArray(rawMeta) && rawMeta.length > 0) {
    const fromMeta = rawMeta
      .map((item) => normalizeArtifact(item as DtChatArtifact))
      .filter((item): item is DtChatArtifact => item != null);
    if (fromMeta.length > 0) return fromMeta.slice(0, DT_CHAT_ARTIFACT_MAX_COUNT);
  }
  return parseDtChatArtifactsFromText(input.content);
}

export function buildDtChatArtifactMetadata(artifacts: DtChatArtifact[]) {
  return artifacts.slice(0, DT_CHAT_ARTIFACT_MAX_COUNT);
}

export function formatDtChatArtifactFence(artifact: DtChatArtifact): string {
  const header = [
    "```dt-artifact",
    `filename: ${artifact.filename}`,
    `mimeType: ${artifact.mimeType}`,
    artifact.title ? `title: ${artifact.title}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return `${header}\n\n${artifact.content}\n\`\`\``;
}

/** Re-attach stored artifacts so follow-up turns can revise the files. */
export function contentWithDtChatArtifactsForLlm(
  content: string,
  metadata?: Record<string, unknown> | null,
): string {
  const artifacts = extractDtChatArtifactsFromMessage({ content: "", metadata });
  if (artifacts.length === 0) return content;
  const stripped = stripDtChatArtifactBlocks(content);
  const fences = artifacts.map(formatDtChatArtifactFence).join("\n\n");
  return stripped ? `${stripped}\n\n${fences}` : fences;
}
