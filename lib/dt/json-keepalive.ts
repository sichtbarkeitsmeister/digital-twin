/**
 * JSON response that writes whitespace while the handler is still working.
 * Proxies drop a silent connection; `response.json()` still parses the body
 * because JSON allows leading whitespace.
 */

const encoder = new TextEncoder();

export type JsonKeepaliveOptions = {
  /** Milliseconds between padding chunks. */
  intervalMs?: number;
  /** Bytes of newline padding per chunk. Large enough to pass a proxy buffer. */
  padBytes?: number;
};

export function jsonKeepaliveResponse(
  work: () => Promise<unknown>,
  options?: JsonKeepaliveOptions,
): Response {
  const intervalMs = options?.intervalMs ?? 6_000;
  const padBytes = options?.padBytes ?? 8_192;
  const pad = encoder.encode("\n".repeat(padBytes));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const push = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      push(pad);
      const timer = setInterval(() => push(pad), intervalMs);
      let body: unknown;
      try {
        body = await work();
      } catch (err) {
        console.error("[json-keepalive]", err);
        body = { ok: false, message: "Antwort fehlgeschlagen." };
      } finally {
        clearInterval(timer);
      }
      let encoded: Uint8Array;
      try {
        encoded = encoder.encode(JSON.stringify(body));
      } catch (err) {
        console.error("[json-keepalive] stringify:", err);
        encoded = encoder.encode(
          JSON.stringify({ ok: false, message: "Antwort fehlgeschlagen." }),
        );
      }
      push(encoded);
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
