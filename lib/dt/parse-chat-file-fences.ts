import { buildCreatedChatFile, type DtCreatedChatFile } from "@/lib/dt/chat-files";

const FILE_FENCE_RE =
  /```(?:file|artifact)(?:\s+|:|filename=)([^\n`]+)\n([\s\S]*?)```/gi;
const LANG_FILE_FENCE_RE =
  /```(html|markdown|md|txt|text|csv|json|pdf|xlsx)(?::|\s+filename=)([^\n`]+)\n([\s\S]*?)```/gi;

function normalizeFenceFormat(raw: string): string {
  const n = raw.trim().toLowerCase();
  if (n === "md") return "markdown";
  if (n === "txt") return "text";
  return n;
}

function parseHeader(header: string): { fileName: string; format?: string } {
  const trimmed = header.trim().replace(/^["']|["']$/g, "");
  const formatMatch = trimmed.match(/\bformat\s*=\s*["']?([a-z0-9]+)["']?/i);
  const nameMatch = trimmed.match(/\b(?:filename|name)\s*=\s*["']?([^"'\s]+)["']?/i);
  if (nameMatch?.[1]) {
    return { fileName: nameMatch[1], format: formatMatch?.[1] };
  }
  const first = trimmed.split(/\s+/)[0] ?? "datei.txt";
  return { fileName: first, format: formatMatch?.[1] };
}

export function stripDtCreatedFileFences(text: string): string {
  return text.replace(FILE_FENCE_RE, "").replace(LANG_FILE_FENCE_RE, "").trimEnd();
}

export async function parseDtCreatedFilesFromText(text: string): Promise<DtCreatedChatFile[]> {
  const files: DtCreatedChatFile[] = [];
  const seen = new Set<string>();

  const add = async (fileName: string, format: string | undefined, body: string) => {
    const built = await buildCreatedChatFile({
      fileName,
      format: format || undefined,
      content: body.trim(),
    });
    if (!built.ok) return;
    const key = built.file.fileName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    files.push(built.file);
  };

  for (const match of text.matchAll(FILE_FENCE_RE)) {
    const header = parseHeader(match[1] ?? "");
    await add(header.fileName, header.format, match[2] ?? "");
    if (files.length >= 4) return files;
  }

  for (const match of text.matchAll(LANG_FILE_FENCE_RE)) {
    await add(match[2]?.trim() || "datei", normalizeFenceFormat(match[1] ?? "text"), match[3] ?? "");
    if (files.length >= 4) return files;
  }

  return files;
}
