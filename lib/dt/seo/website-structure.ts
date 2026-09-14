export type WebsiteStructureNode = {
  label: string;
  path?: string;
  children: WebsiteStructureNode[];
};

export type ParsedWebsiteStructure = {
  nodes: WebsiteStructureNode[];
  outline: string;
  nodeCount: number;
  format: "sitemap" | "json" | "csv" | "markdown" | "indented" | "urls";
  truncated: boolean;
};

export const WEBSITE_STRUCTURE_MAX_RAW_CHARS = 200_000;
export const WEBSITE_STRUCTURE_MAX_OUTLINE_CHARS = 16_000;
export const WEBSITE_STRUCTURE_MAX_NODES = 800;

const PATHISH = /^(https?:\/\/|\/)[\w\-./%?#=&]+$/i;

/**
 * Postgres/PostgREST JSON rejects NUL (`\u0000`) with
 * "unsupported Unicode escape sequence". Word/XML/UTF-16 dumps often contain it.
 */
export function sanitizeWebsiteStructureText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function clipWebsiteStructureRaw(text: string): string {
  const trimmed = sanitizeWebsiteStructureText(text).replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= WEBSITE_STRUCTURE_MAX_RAW_CHARS) return trimmed;
  return trimmed.slice(0, WEBSITE_STRUCTURE_MAX_RAW_CHARS);
}

function countNodes(nodes: WebsiteStructureNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

function splitLabelAndPath(raw: string): { label: string; path?: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { label: "" };
  const parts = text.split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length >= 2 && PATHISH.test(last)) {
    return { label: parts.slice(0, -1).join(" ").replace(/[:–—-]+$/, "").trim() || last, path: last };
  }
  if (PATHISH.test(text)) {
    return { label: pathToLabel(text), path: text };
  }
  return { label: text };
}

function pathToLabel(path: string): string {
  try {
    const u = path.startsWith("http") ? new URL(path) : null;
    const pathname = u ? u.pathname : path;
    const seg = pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    if (!seg) return u?.hostname || pathname || path;
    return decodeURIComponent(seg).replace(/[-_]+/g, " ");
  } catch {
    return path;
  }
}

function insertPathTree(root: WebsiteStructureNode[], url: string): void {
  let pathname = url.trim();
  let origin = "";
  try {
    const parsed = new URL(url);
    origin = `${parsed.origin}`;
    pathname = parsed.pathname || "/";
  } catch {
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  }

  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) {
    if (!root.some((n) => n.path === (origin || "/") || n.label === "Startseite")) {
      root.unshift({ label: "Startseite", path: origin || "/", children: [] });
    }
    return;
  }

  let siblings = root;
  let built = origin || "";
  for (const seg of segments) {
    built += `/${seg}`;
    const existing = siblings.find((n) => n.path === built);
    if (existing) {
      siblings = existing.children;
      continue;
    }
    const node: WebsiteStructureNode = {
      label: decodeURIComponent(seg).replace(/[-_]+/g, " "),
      path: built.startsWith("http") ? built : built,
      children: [],
    };
    siblings.push(node);
    siblings = node.children;
  }
}

function parseSitemapXml(text: string): WebsiteStructureNode[] {
  const locs = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) =>
    (m[1] ?? "").trim(),
  );
  const root: WebsiteStructureNode[] = [];
  for (const loc of locs) {
    if (loc) insertPathTree(root, loc);
  }
  return root;
}

function asNode(value: unknown): WebsiteStructureNode | null {
  if (typeof value === "string") {
    const { label, path } = splitLabelAndPath(value);
    return label ? { label, path, children: [] } : null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const rawLabel = String(rec.label ?? rec.title ?? rec.name ?? rec.page ?? "").trim();
  const rawPath = String(rec.path ?? rec.url ?? rec.href ?? "").trim();
  const { label, path } = splitLabelAndPath(
    [rawLabel, rawPath].filter(Boolean).join(" "),
  );
  if (!label && !path) return null;
  const kidsRaw = rec.children ?? rec.pages ?? rec.items;
  const children = Array.isArray(kidsRaw)
    ? kidsRaw.map(asNode).filter((n): n is WebsiteStructureNode => Boolean(n))
    : [];
  return { label: label || pathToLabel(path ?? ""), path: path || rawPath || undefined, children };
}

function parseJsonTree(text: string): WebsiteStructureNode[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(asNode).filter((n): n is WebsiteStructureNode => Boolean(n));
    }
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const list = rec.pages ?? rec.children ?? rec.items ?? rec.structure ?? rec.tree;
      if (Array.isArray(list)) {
        return list.map(asNode).filter((n): n is WebsiteStructureNode => Boolean(n));
      }
      const single = asNode(parsed);
      return single ? [single] : null;
    }
  } catch {
    return null;
  }
  return null;
}

function parseCsv(text: string): WebsiteStructureNode[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return null;
  const header = lines[0]!.toLowerCase();
  if (!/(url|path|pfad|seite|page|title|label|titel)/.test(header)) return null;

  const cols = header.split(/[,;\t]/).map((c) => c.trim());
  const urlIdx = cols.findIndex((c) => /^(url|path|pfad|href)$/.test(c));
  const titleIdx = cols.findIndex((c) => /^(title|label|titel|name|seite|page)$/.test(c));
  if (urlIdx < 0 && titleIdx < 0) return null;

  const root: WebsiteStructureNode[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const path = urlIdx >= 0 ? parts[urlIdx] : "";
    const title = titleIdx >= 0 ? parts[titleIdx] : "";
    if (path && PATHISH.test(path)) {
      insertPathTree(root, path);
      if (title) {
        const leaf = findByPath(root, path) ?? findByPathSuffix(root, path);
        if (leaf && title) leaf.label = title;
      }
    } else if (title) {
      root.push({ label: title, path: path || undefined, children: [] });
    }
  }
  return root.length ? root : null;
}

function findByPath(nodes: WebsiteStructureNode[], path: string): WebsiteStructureNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const hit = findByPath(n.children, path);
    if (hit) return hit;
  }
  return null;
}

function findByPathSuffix(nodes: WebsiteStructureNode[], path: string): WebsiteStructureNode | null {
  try {
    const suffix = new URL(path).pathname;
    return findByPath(nodes, suffix) ?? findByPath(nodes, path);
  } catch {
    return null;
  }
}

type FlatLine = { indent: number; text: string };

function markdownIndent(line: string): number | null {
  const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  if (!m) return null;
  const spaces = (m[1] ?? "").replace(/\t/g, "  ").length;
  return Math.floor(spaces / 2);
}

function parseNestedLines(text: string, mode: "markdown" | "indented"): WebsiteStructureNode[] {
  const rows: FlatLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    if (mode === "markdown") {
      const indent = markdownIndent(raw);
      if (indent == null) continue;
      const textPart = raw.replace(/^\s*([-*+]|\d+[.)])\s+/, "").trim();
      if (textPart) rows.push({ indent, text: textPart });
    } else {
      if (/^\s*([-*+]|\d+[.)])\s+/.test(raw)) {
        const indent = markdownIndent(raw);
        if (indent != null) {
          rows.push({
            indent,
            text: raw.replace(/^\s*([-*+]|\d+[.)])\s+/, "").trim(),
          });
          continue;
        }
      }
      const leading = raw.replace(/\t/g, "  ").match(/^(\s*)/);
      const indent = Math.floor((leading?.[1]?.length ?? 0) / 2);
      rows.push({ indent, text: raw.trim() });
    }
  }
  if (rows.length === 0) return [];

  const minIndent = Math.min(...rows.map((r) => r.indent));
  const stack: { indent: number; node: WebsiteStructureNode }[] = [];
  const root: WebsiteStructureNode[] = [];

  for (const row of rows) {
    const { label, path } = splitLabelAndPath(row.text);
    if (!label) continue;
    const node: WebsiteStructureNode = { label, path, children: [] };
    const indent = row.indent - minIndent;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1]!.node.children.push(node);
    }
    stack.push({ indent, node });
  }
  return root;
}

function parseUrlList(text: string): WebsiteStructureNode[] {
  const root: WebsiteStructureNode[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (PATHISH.test(t)) insertPathTree(root, t);
    else {
      const { label, path } = splitLabelAndPath(t);
      if (label) root.push({ label, path, children: [] });
    }
  }
  return root;
}

function looksLikeMarkdownList(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const hits = lines.filter((l) => /^\s*([-*+]|\d+[.)])\s+\S/.test(l)).length;
  return hits / lines.length >= 0.5;
}

function looksLikeIndentedTree(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const indented = lines.filter((l) => /^\s+\S/.test(l)).length;
  return indented >= 2;
}

export function formatWebsiteStructureOutline(
  nodes: WebsiteStructureNode[],
  options?: { maxChars?: number; maxNodes?: number },
): { outline: string; nodeCount: number; truncated: boolean } {
  const maxChars = options?.maxChars ?? WEBSITE_STRUCTURE_MAX_OUTLINE_CHARS;
  const maxNodes = options?.maxNodes ?? WEBSITE_STRUCTURE_MAX_NODES;
  const total = countNodes(nodes);
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  function walk(list: WebsiteStructureNode[], depth: number) {
    for (const node of list) {
      if (used >= maxNodes) {
        truncated = true;
        return;
      }
      const pad = "  ".repeat(depth);
      const pathBit = node.path && node.path !== node.label ? ` — ${node.path}` : "";
      const line = `${pad}- ${node.label}${pathBit}`;
      if (lines.join("\n").length + line.length + 1 > maxChars) {
        truncated = true;
        return;
      }
      lines.push(line);
      used += 1;
      if (node.children.length) walk(node.children, depth + 1);
      if (truncated) return;
    }
  }

  walk(nodes, 0);
  let outline = lines.join("\n").trim();
  if (!outline) outline = "(leere Struktur)";
  if (truncated) {
    outline += `\n… (${Math.max(total - used, 0)} weitere Einträge gekürzt)`;
  }
  return { outline, nodeCount: total, truncated: truncated || total > used };
}

export function parseWebsiteStructure(raw: string): ParsedWebsiteStructure {
  const text = clipWebsiteStructureRaw(raw);
  if (!text) {
    throw new Error("Kein Text in der Webseitenstruktur.");
  }

  let format: ParsedWebsiteStructure["format"] = "indented";
  let nodes: WebsiteStructureNode[] = [];

  if (/<urlset[\s>]|<sitemapindex[\s>]/i.test(text) && /<loc>/i.test(text)) {
    nodes = parseSitemapXml(text);
    format = "sitemap";
  } else if (/^\s*[\[{]/.test(text)) {
    const json = parseJsonTree(text);
    if (json && json.length) {
      nodes = json;
      format = "json";
    }
  }

  if (nodes.length === 0) {
    const csv = parseCsv(text);
    if (csv && csv.length) {
      nodes = csv;
      format = "csv";
    }
  }

  if (nodes.length === 0 && looksLikeMarkdownList(text)) {
    nodes = parseNestedLines(text, "markdown");
    format = "markdown";
  }

  if (nodes.length === 0 && looksLikeIndentedTree(text)) {
    nodes = parseNestedLines(text, "indented");
    format = "indented";
  }

  if (nodes.length === 0) {
    nodes = parseUrlList(text);
    format = nodes.some((n) => n.path && PATHISH.test(n.path)) ? "urls" : "indented";
  }

  if (countNodes(nodes) === 0) {
    throw new Error("In der Datei wurde keine Seitenstruktur erkannt.");
  }

  const formatted = formatWebsiteStructureOutline(nodes);
  return {
    nodes,
    outline: formatted.outline,
    nodeCount: formatted.nodeCount,
    format,
    truncated: formatted.truncated,
  };
}

export function formatWebsiteStructureForPrompt(input: {
  outline: string;
  nodeCount: number;
  filename?: string | null;
  uploadedAt?: string | null;
  notes?: string | null;
  emptyHint?: boolean;
}): string {
  if (!input.outline.trim()) {
    if (!input.emptyHint) return "";
    return [
      "## Webseitenstruktur (hochgeladen)",
      "Noch keine Webseitenstruktur hinterlegt. Der Nutzer kann sie unter SEO → Struktur als Datei oder Text hochladen (Markdown-Baum, Sitemap-XML, URL-Liste).",
    ].join("\n");
  }

  const meta = [
    input.filename?.trim() ? `Datei: ${input.filename.trim()}` : null,
    `${input.nodeCount} Einträge`,
    input.uploadedAt
      ? `Stand: ${new Date(input.uploadedAt).toLocaleDateString("de-DE")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks = [
    "## Webseitenstruktur (hochgeladen)",
    meta,
    input.notes?.trim() ? `Notiz: ${input.notes.trim()}` : "",
    "",
    input.outline.trim(),
    "",
    "Nutzung: Das ist die geplante/kommunizierte Informationsarchitektur — nicht der Crawl-Index. Du darfst sie einsehen, zusammenfassen und Verbesserungen vorschlagen (fehlende Seiten, unklare Hierarchie, SEO-IA, interne Verlinkung). Vergleiche mit „Prüfbare Unterseiten“ (Crawl) und der Sitemap, wenn nach Ist vs. Soll gefragt wird. Behaupte nicht, eine URL existiere live, nur weil sie hier steht — dafür Crawl- oder Live-Tools nutzen. Wenn der Nutzer einen klickbaren Navigations- oder Seitenprototyp will, liefere eine HTML-Datei als dt-artifact (Download), nicht nur eine Beschreibung.",
  ];
  return blocks.filter((l) => l !== "").join("\n");
}
