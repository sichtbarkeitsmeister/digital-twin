/**
 * A small Markdown reader for what the Digital Twin writes: headings, paragraphs, bold and italic, lists
 * (also nested by indentation), tables, quotes, code, rules, links. No dependencies, pure. It feeds the
 * PDF the twin creates (headings and lists drawn as such, no „##“ in the file) and the HTML of created
 * files. Anything it does not know stays plain text; HTML in the input is escaped, never passed on.
 */

export type MdSpan = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; spans: MdSpan[] }
  | { type: "paragraph"; spans: MdSpan[] }
  | { type: "list"; ordered: boolean; items: Array<{ spans: MdSpan[]; depth: number; number: number }> }
  | { type: "table"; header: MdSpan[][]; rows: MdSpan[][][] }
  | { type: "quote"; spans: MdSpan[] }
  | { type: "code"; text: string }
  | { type: "rule" };

/** The span with only the marks that are on (no `undefined` keys). */
function styled(span: MdSpan, bold: boolean, italic: boolean): MdSpan {
  if (bold) span.bold = true;
  if (italic) span.italic = true;
  return span;
}

/** Inline Markdown → spans: **bold**, __bold__, *italic*, _italic_, `code`, [text](url). */
export function parseInline(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const push = (span: MdSpan) => {
    if (!span.text) return;
    const last = spans[spans.length - 1];
    if (last && !last.code && !span.code && !last.href && !span.href && last.bold === span.bold && last.italic === span.italic) last.text += span.text;
    else spans.push(span);
  };
  let rest = text;
  let bold = false;
  let italic = false;
  while (rest.length > 0) {
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      push({ text: code[1]!, code: true });
      rest = rest.slice(code[0].length);
      continue;
    }
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      push(styled({ text: link[1]!, href: link[2]! }, bold, italic));
      rest = rest.slice(link[0].length);
      continue;
    }
    // An underscore inside a word (snake_case_name) is no mark; stars work anywhere.
    const prev = text[text.length - rest.length - 1] ?? "";
    const at = (n: number) => rest[n] ?? "";
    const wordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);
    const underscoreInWord = (width: number) => rest[0] === "_" && (wordChar(prev) || wordChar(at(width)));
    if (/^(\*\*|__)(?=\S)/.test(rest) && !bold && !underscoreInWord(2)) {
      bold = true;
      rest = rest.slice(2);
      continue;
    }
    if (/^(\*\*|__)/.test(rest) && bold && !underscoreInWord(2)) {
      bold = false;
      rest = rest.slice(2);
      continue;
    }
    if (/^[*_](?=[^\s*_])/.test(rest) && !italic && !underscoreInWord(1)) {
      italic = true;
      rest = rest.slice(1);
      continue;
    }
    if (/^[*_]/.test(rest) && italic && !underscoreInWord(1)) {
      italic = false;
      rest = rest.slice(1);
      continue;
    }
    // Plain run up to the next special character.
    const next = rest.slice(1).search(/[`[*_]/);
    const run = next < 0 ? rest : rest.slice(0, next + 1);
    push(styled({ text: run }, bold, italic));
    rest = rest.slice(run.length);
  }
  return spans;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");

export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: Math.min(4, heading[1]!.length) as 1 | 2 | 3 | 4, spans: parseInline(heading[2]!) });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flush();
      const header = cells(line).map(parseInline);
      const rows: MdSpan[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(cells(lines[i++]!).map(parseInline));
      i--;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const item = line.match(/^(\s*)([-*•+]|\d+[.)])\s+(.+)$/);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]!);
      const last = blocks[blocks.length - 1];
      const list: Extract<MdBlock, { type: "list" }> =
        last && last.type === "list" && last.ordered === ordered ? last : { type: "list", ordered, items: [] };
      if (list !== last) blocks.push(list);
      const depth = Math.min(3, Math.floor(item[1]!.replace(/\t/g, "  ").length / 2));
      const number = ordered ? list.items.filter((x) => x.depth === depth).length + 1 : 0;
      list.items.push({ spans: parseInline(item[3]!), depth, number });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const quote: string[] = [line.replace(/^\s*>\s?/, "")];
      while (i + 1 < lines.length && /^\s*>\s?/.test(lines[i + 1]!)) quote.push(lines[++i]!.replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", spans: parseInline(quote.join(" ")) });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** The text without Markdown marks (for places that cannot draw it). */
export function spansToText(spans: readonly MdSpan[]): string {
  return spans.map((s) => s.text).join("");
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const safeHref = (href: string) => (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href) ? href : "");

function spansToHtml(spans: readonly MdSpan[]): string {
  return spans
    .map((s) => {
      let html = esc(s.text);
      if (s.code) html = `<code>${html}</code>`;
      if (s.bold) html = `<strong>${html}</strong>`;
      if (s.italic) html = `<em>${html}</em>`;
      const href = s.href ? safeHref(s.href) : "";
      return href ? `<a href="${esc(href)}">${html}</a>` : html;
    })
    .join("");
}

/** Blocks → clean HTML (headings, paragraphs, lists, tables with borders, quotes, code). */
export function blocksToHtml(blocks: readonly MdBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        out.push(`<h${block.level}>${spansToHtml(block.spans)}</h${block.level}>`);
        break;
      case "paragraph":
        out.push(`<p>${spansToHtml(block.spans)}</p>`);
        break;
      case "quote":
        out.push(`<blockquote>${spansToHtml(block.spans)}</blockquote>`);
        break;
      case "code":
        out.push(`<pre><code>${esc(block.text)}</code></pre>`);
        break;
      case "rule":
        out.push("<hr>");
        break;
      case "list": {
        // Nested items become nested lists inside the item above them.
        const tag = block.ordered ? "ol" : "ul";
        let html = "";
        let depth = -1;
        for (const item of block.items) {
          if (item.depth > depth) {
            while (depth < item.depth) {
              html += `<${tag}>`;
              depth++;
              if (depth < item.depth) html += "<li>";
            }
          } else {
            html += "</li>";
            while (depth > item.depth) {
              html += `</${tag}></li>`;
              depth--;
            }
          }
          html += `<li>${spansToHtml(item.spans)}`;
        }
        html += "</li>";
        while (depth > 0) {
          html += `</${tag}></li>`;
          depth--;
        }
        html += `</${tag}>`;
        out.push(html);
        break;
      }
      case "table":
        out.push(
          `<table style="border-collapse:collapse" border="1" cellpadding="6"><thead><tr>${block.header.map((h) => `<th style="border:1px solid #bbb;text-align:left">${spansToHtml(h)}</th>`).join("")}</tr></thead><tbody>${block.rows
            .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #bbb">${spansToHtml(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
        );
        break;
    }
  }
  return out.join("\n");
}

/** Markdown → clean HTML. */
export function markdownToHtml(markdown: string): string {
  return blocksToHtml(parseMarkdown(markdown));
}

/** Whether a text reads as Markdown (a heading, list, table, bold or a rule), not as plain prose. */
export function looksLikeMarkdown(text: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/m.test(text) || /^\s*[-*•]\s+\S/m.test(text) || /^\s*\d+[.)]\s+\S/m.test(text) || /\*\*[^*\n]+\*\*/.test(text) || /^\s*\|.+\|\s*$/m.test(text);
}

/** Blocks → readable plain text: headings as their own lines, bullets as „• “, tables as tab-separated rows. */
export function blocksToPlainText(blocks: readonly MdBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "quote":
        out.push(spansToText(block.spans));
        break;
      case "code":
        out.push(block.text);
        break;
      case "rule":
        out.push("---");
        break;
      case "list":
        out.push(block.items.map((i) => `${"  ".repeat(i.depth)}${block.ordered ? `${i.number}.` : "•"} ${spansToText(i.spans)}`).join("\n"));
        break;
      case "table":
        out.push([block.header, ...block.rows].map((row) => row.map(spansToText).join("\t")).join("\n"));
        break;
    }
  }
  return out.join("\n\n");
}

/** Markdown → plain text without the marks. */
export function markdownToPlainText(markdown: string): string {
  return blocksToPlainText(parseMarkdown(markdown));
}
