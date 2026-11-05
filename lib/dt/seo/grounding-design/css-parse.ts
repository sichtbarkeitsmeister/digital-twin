/**
 * A small, forgiving CSS reader for design detection: style rules (selectors + declarations),
 * @font-face blocks and @import URLs, with the @media context of each rule. Not a full CSS
 * parser: it only has to survive real theme CSS (minified, comments, strings, nesting of
 * @media/@supports/@layer) and never throw. Pure.
 */

export type CssDeclaration = { property: string; value: string; important: boolean };

export type CssStyleRule = {
  kind: "style";
  selectors: string[];
  declarations: CssDeclaration[];
  /** Conditions of the enclosing @media blocks, outermost first. */
  media: string[];
  /** Position in the whole cascade (all sources in document order). */
  order: number;
  /** URL of the stylesheet (null for inline <style>). */
  sourceUrl: string | null;
};

export type CssFontFaceRule = {
  kind: "font-face";
  declarations: CssDeclaration[];
  order: number;
  sourceUrl: string | null;
};

export type ParsedCss = {
  rules: CssStyleRule[];
  fontFaces: CssFontFaceRule[];
  imports: string[];
};

const GROUPING_AT_RULES = new Set(["media", "supports", "layer", "container", "document", "scope"]);

function stripComments(css: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < css.length) {
    const ch = css[i]!;
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Index of the first `stop` character at depth 0 (outside strings, parens, brackets), or -1. */
function scanTo(css: string, from: number, stops: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && stops.includes(ch)) return i;
  }
  return -1;
}

/** Index of the `}` closing the block opened at `open`, or the end of the text. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

/** Split at a separator outside strings and parentheses. */
export function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (;;) {
    const i = scanTo(text, start, separator);
    if (i < 0) {
      out.push(text.slice(start));
      return out;
    }
    out.push(text.slice(start, i));
    start = i + 1;
  }
}

export function parseDeclarations(body: string): CssDeclaration[] {
  // Nested rules (CSS nesting) are not declarations: drop their blocks.
  let flat = body;
  for (let guard = 0; guard < 50 && flat.includes("{"); guard++) {
    const open = flat.indexOf("{");
    const close = blockEnd(flat, open);
    const start = flat.lastIndexOf(";", open) + 1;
    flat = `${flat.slice(0, start)}${flat.slice(close + 1)}`;
  }
  const out: CssDeclaration[] = [];
  for (const part of splitTopLevel(flat, ";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const property = part.slice(0, colon).trim();
    if (!/^(--[\w-]+|-?[a-z][a-z-]*)$/i.test(property)) continue;
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    out.push({ property: property.startsWith("--") ? property : property.toLowerCase(), value, important });
  }
  return out;
}

/**
 * Parse one stylesheet. `startOrder` continues the cascade order across sources; the
 * returned `nextOrder` is where the next source starts.
 */
export function parseCss(
  raw: string,
  opts: { sourceUrl?: string | null; startOrder?: number } = {},
): ParsedCss & { nextOrder: number } {
  const css = stripComments(raw);
  const result: ParsedCss = { rules: [], fontFaces: [], imports: [] };
  let order = opts.startOrder ?? 0;
  const sourceUrl = opts.sourceUrl ?? null;

  const walk = (from: number, to: number, media: string[]) => {
    let i = from;
    while (i < to) {
      while (i < to && /\s|;/.test(css[i]!)) i++;
      if (i >= to) return;
      if (css[i] === "}") {
        i++;
        continue;
      }
      if (css[i] === "@") {
        const name = /^@([\w-]+)/.exec(css.slice(i, i + 40))?.[1]?.toLowerCase() ?? "";
        const stop = scanTo(css, i, "{;");
        if (stop < 0 || stop >= to) return;
        const prelude = css.slice(i + 1 + name.length, stop).trim();
        if (css[stop] === ";") {
          if (name === "import") {
            const url = /url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["']/.exec(prelude);
            const value = url?.[1] ?? url?.[2];
            if (value) result.imports.push(value.trim());
          }
          i = stop + 1;
          continue;
        }
        const end = Math.min(blockEnd(css, stop), to);
        if (name === "font-face") {
          result.fontFaces.push({ kind: "font-face", declarations: parseDeclarations(css.slice(stop + 1, end)), order: order++, sourceUrl });
        } else if (GROUPING_AT_RULES.has(name)) {
          walk(stop + 1, end, name === "media" ? [...media, prelude.toLowerCase()] : media);
        }
        i = end + 1;
        continue;
      }
      const open = scanTo(css, i, "{}");
      if (open < 0 || open >= to) return;
      if (css[open] === "}") {
        i = open + 1;
        continue;
      }
      const end = Math.min(blockEnd(css, open), to);
      const selectors = splitTopLevel(css.slice(i, open), ",")
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (selectors.length > 0) {
        result.rules.push({ kind: "style", selectors, declarations: parseDeclarations(css.slice(open + 1, end)), media, order: order++, sourceUrl });
      }
      i = end + 1;
    }
  };

  walk(0, css.length, []);
  return { ...result, nextOrder: order };
}

/** `url(...)` and `format(...)` pairs of a @font-face src. */
export function parseFontSrc(value: string): Array<{ url: string; format: string | null }> {
  const out: Array<{ url: string; format: string | null }> = [];
  for (const part of splitTopLevel(value, ",")) {
    const url = /url\(\s*(["']?)([^"')]+)\1\s*\)/i.exec(part)?.[2]?.trim();
    if (!url) continue;
    const format = /format\(\s*["']?([\w-]+)["']?\s*\)/i.exec(part)?.[1]?.toLowerCase() ?? null;
    out.push({ url, format });
  }
  return out;
}
