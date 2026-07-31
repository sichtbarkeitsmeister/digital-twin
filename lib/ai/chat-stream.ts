export function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}

const HEARTBEAT_MS = 12_000;

/**
 * SSE stream helper. Sends periodic comment heartbeats so proxies/load-balancers
 * do not idle-close the connection during long Anthropic calls with no events.
 */
export function createSseStream(
  run: (emit: (event: string, payload: unknown) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: string, payload: unknown) => {
        if (closed) return;
        const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(body));
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          // SSE comment — ignored by EventSource/clients, keeps the pipe warm.
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          /* controller already closed */
        }
      }, HEARTBEAT_MS);
      try {
        await run(emit);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown stream error.";
        try {
          emit("error", { message });
        } catch {
          /* ignore */
        }
      } finally {
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });
}
