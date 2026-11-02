/**
 * How the chat client reads route answers and names failures (`lib/dt/chat/chat-response.ts`).
 * Run: npx tsx scripts/test-dt-chat-response.ts
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  dtChatJsonFailureMessage,
  dtChatSendFailureStatus,
  dtChatStateAfterFailedSend,
  dtChatThrownFailureMessage,
  parseDtChatResponseBody,
  postDtChatJson,
} from "../lib/dt/chat/chat-response";

const PADDING = "\n".repeat(8_192);

function failureOf(result: ReturnType<typeof parseDtChatResponseBody>) {
  assert.equal(result.ok, false, "expected a failure");
  return (result as Extract<typeof result, { ok: false }>).failure;
}

function testPaddedJsonParses() {
  const result = parseDtChatResponseBody({
    status: 200,
    body: `${PADDING}${PADDING}{"ok":true,"via":"anthropic_direct"}`,
    elapsedMs: 90_000,
  });
  assert.deepEqual(result, { ok: true, json: { ok: true, via: "anthropic_direct" } });
  console.log("padded json parses: ok");
}

function testPaddingOnlyNearLimitIsTimeLimit() {
  const failure = failureOf(parseDtChatResponseBody({ status: 200, body: PADDING.repeat(40), elapsedMs: 300_400 }));
  assert.equal(failure.cause, "time_limit");
  assert.match(failure.message, /Zeitlimit des Servers \(5 Minuten\)/);
  assert.match(failure.message, /kleinere Schritte/);
  console.log("padding only near the limit is the time limit: ok");
}

function testPaddingOnlyEarlyIsCutOff() {
  const failure = failureOf(parseDtChatResponseBody({ status: 200, body: PADDING, elapsedMs: 20_000 }));
  assert.equal(failure.cause, "cut_off");
  assert.match(failure.message, /nach 20 Sekunden ab/);
  const half = failureOf(parseDtChatResponseBody({ status: 200, body: `${PADDING}{"ok":tr`, elapsedMs: 40_000 }));
  assert.equal(half.cause, "cut_off", "half a JSON object is a cut-off, not a server error");
  console.log("padding only early is a cut-off: ok");
}

function testVercelErrorPages() {
  const timeout = failureOf(
    parseDtChatResponseBody({
      status: 504,
      body: "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\niad1::abcde-123",
      elapsedMs: 300_000,
    }),
  );
  assert.equal(timeout.cause, "time_limit");
  assert.equal(timeout.detail, "HTTP 504, FUNCTION_INVOCATION_TIMEOUT");

  const tooLarge = failureOf(
    parseDtChatResponseBody({
      status: 413,
      body: "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE\n",
      elapsedMs: 300,
    }),
  );
  assert.equal(tooLarge.cause, "too_large");
  assert.match(tooLarge.message, /höchstens etwa 3 MB/);

  const crashed = failureOf(
    parseDtChatResponseBody({
      status: 500,
      body: "A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n",
      elapsedMs: 4_000,
    }),
  );
  assert.equal(crashed.cause, "server_error");
  assert.equal(crashed.message, "Serverfehler (HTTP 500, FUNCTION_INVOCATION_FAILED). Bitte erneut versuchen.");

  const html = failureOf(
    parseDtChatResponseBody({ status: 502, body: "<!DOCTYPE html><html><body>Bad gateway</body></html>", elapsedMs: 1_000 }),
  );
  assert.equal(html.message, "Serverfehler (HTTP 502). Bitte erneut versuchen.");
  console.log("vercel error pages: ok");
}

function testJsonFailureMessage() {
  assert.equal(dtChatJsonFailureMessage({ message: "Chat nicht gefunden." }, 404), "Chat nicht gefunden.");
  assert.equal(dtChatJsonFailureMessage({}, 500), "Antwort fehlgeschlagen (HTTP 500).");
  assert.equal(dtChatJsonFailureMessage({ message: "  " }, 200), "Antwort fehlgeschlagen.");
  console.log("json failure message: ok");
}

function testThrownFailureMessage() {
  assert.match(dtChatThrownFailureMessage(new TypeError("Failed to fetch")), /nicht erreicht \(Netzwerkfehler\)/);
  assert.equal(
    dtChatThrownFailureMessage(new Error("boom")),
    "Unerwarteter Fehler im Browser (boom). Bitte erneut versuchen.",
  );
  console.log("thrown failure message: ok");
}

function testStateAfterFailedSend() {
  const sent = "Optimiere die Unterseite.";
  assert.deepEqual(
    dtChatStateAfterFailedSend(
      [
        { role: "user", content: "Frage davor" },
        { role: "assistant", content: "Antwort davor" },
        { role: "user", content: sent },
      ],
      sent,
    ),
    { userSaved: true, replyArrived: false },
  );
  assert.deepEqual(
    dtChatStateAfterFailedSend(
      [
        { role: "user", content: sent },
        { role: "assistant", content: "Die Antwort kam doch an." },
      ],
      sent,
    ),
    { userSaved: true, replyArrived: true },
  );
  assert.deepEqual(
    dtChatStateAfterFailedSend(
      [
        { role: "user", content: "Frage davor" },
        { role: "assistant", content: "Antwort davor" },
      ],
      sent,
    ),
    { userSaved: false, replyArrived: false },
    "an older reply does not count when the message was not saved",
  );
  console.log("state after failed send: ok");
}

function testSendFailureStatus() {
  assert.equal(
    dtChatSendFailureStatus({ message: "Zeitlimit.", userSaved: true, grounding: false }),
    "Zeitlimit. Die Nachricht bleibt im Chat.",
  );
  assert.equal(
    dtChatSendFailureStatus({ message: "Abbruch.", userSaved: false, grounding: true }),
    "Abbruch. Entwurf und HTML-Datei liegen im Tab Grounding.",
  );
  console.log("send failure status: ok");
}

async function testPostAgainstServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.write(PADDING);
      res.end('{"ok":true,"answer":42}');
      return;
    }
    // Like Vercel at the limit: status and padding are out, then the connection dies.
    res.writeHead(200, { "content-type": "application/json" });
    res.write(PADDING);
    setTimeout(() => res.socket?.destroy(), 50);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const originalError = console.error;
  console.error = () => {};
  try {
    const ok = await postDtChatJson<{ ok: boolean; answer: number }>(`${base}/ok`, { content: "x" });
    assert.deepEqual(ok, { ok: true, status: 200, json: { ok: true, answer: 42 } });

    const cut = await postDtChatJson(`${base}/cut`, { content: "x" });
    assert.equal(cut.ok, false);
    assert.equal(!cut.ok && cut.failure.cause, "cut_off");

    await new Promise<void>((resolve) => server.close(() => resolve()));
    const unreachable = await postDtChatJson(`${base}/ok`, { content: "x" });
    assert.equal(!unreachable.ok && unreachable.failure.cause, "unreachable");

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(postDtChatJson(`${base}/ok`, {}, controller.signal), { name: "AbortError" });
  } finally {
    console.error = originalError;
    server.closeAllConnections();
    if (server.listening) server.close();
  }
  console.log("post against a server: ok");
}

async function main() {
  testPaddedJsonParses();
  testPaddingOnlyNearLimitIsTimeLimit();
  testPaddingOnlyEarlyIsCutOff();
  testVercelErrorPages();
  testJsonFailureMessage();
  testThrownFailureMessage();
  testStateAfterFailedSend();
  testSendFailureStatus();
  await testPostAgainstServer();
  console.log("all dt chat response tests passed");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
