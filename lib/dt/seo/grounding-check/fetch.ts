/**
 * Outbound fetch for the Grounding check. Every hop — the first URL and each redirect —
 * passes checkSafePublicUrl, so a public page cannot bounce the server into its own network.
 */

import { USER_AGENT, decodeHtml } from "@/lib/dt/seo/crawl-sitemap";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

export type SafeFetchResult = {
  ok: boolean;
  status: number;
  /** The URL asked for. */
  url: string;
  /** Where the redirects ended. */
  finalUrl: string;
  contentType: string;
  lastModified: string | null;
  body: string;
};

const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

async function readCapped(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = maxBytes - size;
    chunks.push(value.byteLength > room ? value.slice(0, room) : value);
    size += Math.min(value.byteLength, room);
    if (size >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * GET a public URL as text. Null when the URL (or a redirect target) is not allowed, the
 * request fails or the time runs out. Non-2xx answers come back with `ok: false`.
 */
export async function safeFetchText(
  url: string,
  options: { accept: string; timeoutMs: number; maxBytes?: number },
): Promise<SafeFetchResult | null> {
  const first = checkSafePublicUrl(url);
  if (!first.ok) return null;
  const signal = AbortSignal.timeout(options.timeoutMs);
  let current = first.url.toString();
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: options.accept },
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) return null;
        const next = checkSafePublicUrl(new URL(location, current).toString());
        if (!next.ok) return null;
        current = next.url.toString();
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const buffer = await readCapped(res, options.maxBytes ?? DEFAULT_MAX_BYTES);
      return {
        ok: res.ok,
        status: res.status,
        url: first.url.toString(),
        finalUrl: current,
        contentType,
        lastModified: res.headers.get("last-modified"),
        body: decodeHtml(buffer, contentType),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
export const TEXT_ACCEPT = "text/plain,*/*;q=0.8";
