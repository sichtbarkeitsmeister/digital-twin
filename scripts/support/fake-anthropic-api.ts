/**
 * Local stand-in for the Anthropic Messages API (streaming only), for tests of the chat loop.
 * Point the SDK at it with ANTHROPIC_BASE_URL; each request is recorded and answered by `handler`.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type FakeRequestBody = {
  model: string;
  max_tokens: number;
  thinking?: { type: string };
  tools?: Array<{ name: string }>;
  tool_choice?: { type: string };
  messages: Array<{ role: string; content: unknown }>;
};

/** One fake API response; `stall` keeps the stream open until the client gives up. */
export type FakeReply = { events: Array<Record<string, unknown>>; stall?: boolean };
export type FakeHandler = (body: FakeRequestBody, index: number) => FakeReply;

export type FakeAnthropicApi = {
  url: string;
  /** Every request body, in order. Clear it with `seen.length = 0`. */
  seen: FakeRequestBody[];
  handle: (handler: FakeHandler) => void;
  close: () => Promise<void>;
};

export function messageStart(model = "claude-test"): Record<string, unknown> {
  return {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  };
}

export function textReply(text: string, stopReason = "end_turn"): FakeReply {
  return {
    events: [
      messageStart(),
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ],
  };
}

export function createFileReply(id: string): FakeReply {
  const input = JSON.stringify({ filename: `notiz-${id}.md`, format: "markdown", content: "# Notiz\n\nInhalt." });
  return {
    events: [
      messageStart(),
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "create_file", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: input } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 30 } },
      { type: "message_stop" },
    ],
  };
}

/** A decline by the safety filters: HTTP 200, no content, `stop_reason: "refusal"`. */
export function refusalReply(category = "general_harms"): FakeReply {
  return {
    events: [
      messageStart(),
      {
        type: "message_delta",
        delta: {
          stop_reason: "refusal",
          stop_sequence: null,
          stop_details: { type: "refusal", category, explanation: "Test" },
        },
        usage: { output_tokens: 0 },
      },
      { type: "message_stop" },
    ],
  };
}

export async function startFakeAnthropicApi(): Promise<FakeAnthropicApi> {
  const seen: FakeRequestBody[] = [];
  let handler: FakeHandler = () => ({ events: [] });
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as FakeRequestBody;
      seen.push(body);
      const reply = handler(body, seen.length - 1);
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of reply.events) {
        res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      if (!reply.stall) res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    handle: (next) => {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
