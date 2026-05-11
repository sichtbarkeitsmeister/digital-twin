export function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}

export function createSseStream(
  run: (emit: (event: string, payload: unknown) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, payload: unknown) => {
        const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(body));
      };
      try {
        await run(emit);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown stream error.";
        emit("error", { message });
      } finally {
        controller.close();
      }
    },
  });
}

