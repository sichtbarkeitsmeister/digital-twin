/**
 * Guard for server-side fetches of URLs that come from user input, pasted text,
 * crawled page content or LLM tool calls.
 *
 * Without this an injected instruction ("prüfe http://169.254.169.254/...") would
 * make the server request its own network and hand the response back into the chat.
 */
export function isBlockedFetchHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) {
    return true;
  }
  if (h === "127.0.0.1" || h === "::1" || h === "0.0.0.0" || h === "::") return true;
  // IPv4 private / link-local / loopback ranges
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const octet = Number(m172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  // IPv4-mapped IPv6 loopback, e.g. ::ffff:127.0.0.1
  if (/^::ffff:(127|10|192\.168|169\.254)\./.test(h)) return true;
  return false;
}

export type SafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export function checkSafePublicUrl(raw: string): SafeUrlResult {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: false, reason: "Keine URL angegeben." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: `Ungültige URL: ${trimmed}` };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Nur http/https-URLs sind erlaubt." };
  }

  if (isBlockedFetchHost(url.hostname)) {
    return { ok: false, reason: "Interne oder lokale Adressen werden nicht abgerufen." };
  }

  return { ok: true, url };
}

export function isSafePublicUrl(raw: string): boolean {
  return checkSafePublicUrl(raw).ok;
}
