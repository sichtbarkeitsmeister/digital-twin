/**
 * Lenient JSON for tool inputs. Claude sometimes sends a nested tool parameter (an array
 * of text sections, a list of findings) as a JSON-encoded *string* instead of the array
 * itself. Inside that string it writes the JSON by hand and often forgets to escape a
 * quote — typically a German closing quote typed as ASCII: `„Gibt es das?"`. The string
 * then is not valid JSON either, and a strict parse throws the whole answer away.
 *
 * `parseJsonLenient` parses strictly first and, only if that fails, repairs the usual
 * slips (unescaped quotes inside strings, raw line breaks and tabs, a Markdown code fence)
 * and parses again. `reviveStringifiedToolInput` applies it to the top-level properties a
 * tool schema declares as array or object. Pure; safe for client code and tests.
 */

const VALUE_START = /^(?:["{[\]}\-0-9]|true\b|false\b|null\b)/;

function skipWhitespace(text: string, index: number): number {
  let i = index;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

/**
 * Is the quote just before `index` the end of the string? Only if JSON structure follows:
 * `}` / `]` / end of text, or `,` / `:` followed by the start of a value or key. A quote
 * followed by anything else (`</strong>`, a letter, `, sagt er`) is part of the text.
 */
function closesString(text: string, index: number): boolean {
  const k = skipWhitespace(text, index);
  if (k >= text.length) return true;
  const ch = text[k]!;
  if (ch === "}" || ch === "]") return true;
  if (ch === "," || ch === ":") {
    const m = skipWhitespace(text, k + 1);
    return m < text.length && VALUE_START.test(text.slice(m, m + 5));
  }
  return false;
}

/** Escapes quotes and control characters that sit inside JSON strings. */
export function repairJsonText(text: string): string {
  const out: string[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (!inString) {
      if (c === '"') inString = true;
      out.push(c);
      continue;
    }
    if (c === "\\") {
      out.push(c, text[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (c === '"') {
      if (closesString(text, i + 1)) {
        inString = false;
        out.push(c);
      } else {
        out.push('\\"');
      }
      continue;
    }
    if (c === "\n") out.push("\\n");
    else if (c === "\r") out.push("\\r");
    else if (c === "\t") out.push("\\t");
    else out.push(c);
  }
  return out.join("");
}

function stripFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1]! : text.trim();
}

/** Strict parse, then one repaired parse; `undefined` when neither works. */
export function parseJsonLenient(text: string): unknown {
  const candidate = stripFence(text);
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    try {
      return JSON.parse(repairJsonText(candidate)) as unknown;
    } catch {
      return undefined;
    }
  }
}

type SchemaLike = { properties?: Record<string, { type?: unknown } | undefined> } | null | undefined;

/**
 * The tool input with every top-level property the schema declares as `array` or `object`
 * turned back into one, when the model sent it as a JSON string. Anything that does not
 * parse into the declared type stays as it was, so the caller's own checks still apply.
 */
export function reviveStringifiedToolInput(input: unknown, schema: SchemaLike): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input) || !schema?.properties) return input;
  const record = input as Record<string, unknown>;
  let changed: Record<string, unknown> | null = null;
  for (const [key, property] of Object.entries(schema.properties)) {
    const declared = property?.type;
    if (declared !== "array" && declared !== "object") continue;
    const value = record[key];
    if (typeof value !== "string") continue;
    const parsed = parseJsonLenient(value);
    const matches = declared === "array" ? Array.isArray(parsed) : Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
    if (!matches) continue;
    changed ??= { ...record };
    changed[key] = parsed;
  }
  return changed ?? input;
}
