/** Remove lone UTF-16 surrogates and NUL bytes that break JSON API payloads. */
export function sanitizeForLlmText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if (code === 0) continue;
    out += text[i];
  }
  return out;
}

export function decodeResponseTextSafely(bytes: ArrayBuffer): string {
  return sanitizeForLlmText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}
