/**
 * Client side of the chat routes: send a message and read the answer, so that every
 * failure reaches the user with its real cause instead of a generic „Netzwerkfehler“.
 *
 * The routes answer with one JSON object. While the model works they write newline
 * padding (`lib/dt/json-keepalive.ts`), so the status is 200 before the answer exists.
 * When the platform stops the function, the body ends as padding or half an object,
 * which `res.json()` only reports as a parse error.
 */
import { DT_CHAT_ROUTE_MAX_DURATION_MS, formatDtChatDuration } from "@/lib/dt/chat/time-budget";

export type DtChatTransportFailureCause =
  | "unreachable"
  | "time_limit"
  | "cut_off"
  | "too_large"
  | "server_error";

export type DtChatTransportFailure = {
  cause: DtChatTransportFailureCause;
  /** Shown to the user. */
  message: string;
  status?: number;
  /** For the console: HTTP status, platform error code, browser error text. */
  detail?: string;
};

export type DtChatPostResult<T> =
  | { ok: true; status: number; json: T }
  | { ok: false; failure: DtChatTransportFailure };

/** A body that ends this close to the route limit was cut by the platform's timeout. */
const TIME_LIMIT_SLACK_MS = 15_000;

/** Vercel error codes in plain-text error pages, e.g. FUNCTION_INVOCATION_TIMEOUT. */
const PLATFORM_ERROR_CODE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/;

function timeLimitMessage(): string {
  return `Die Antwort hat das Zeitlimit des Servers (${formatDtChatDuration(DT_CHAT_ROUTE_MAX_DURATION_MS)}) überschritten und wurde abgebrochen. Bitte die Aufgabe in kleinere Schritte teilen, z. B. erst die Gliederung, dann Abschnitt für Abschnitt.`;
}

/** The answer stopped before its JSON was complete. */
export function dtChatCutOffFailure(elapsedMs: number, detail?: string): DtChatTransportFailure {
  if (elapsedMs >= DT_CHAT_ROUTE_MAX_DURATION_MS - TIME_LIMIT_SLACK_MS) {
    return { cause: "time_limit", message: timeLimitMessage(), detail };
  }
  return {
    cause: "cut_off",
    message: `Die Verbindung zum Server brach nach ${formatDtChatDuration(elapsedMs)} ab, bevor die Antwort fertig war. Bitte erneut versuchen.`,
    detail,
  };
}

/** The request never reached the server. `online` is `navigator.onLine` where known. */
export function dtChatUnreachableFailure(detail?: string, online?: boolean): DtChatTransportFailure {
  return {
    cause: "unreachable",
    message:
      online === false
        ? "Keine Internetverbindung. Bitte die Verbindung prüfen und erneut versuchen."
        : "Die Nachricht hat den Server nicht erreicht (Netzwerkfehler). Bitte die Internetverbindung prüfen und erneut versuchen.",
    detail,
  };
}

/** The response body as JSON, or the reason there is none. */
export function parseDtChatResponseBody(input: {
  status: number;
  body: string;
  elapsedMs: number;
}): { ok: true; json: unknown } | { ok: false; failure: DtChatTransportFailure } {
  const trimmed = input.body.trim();
  if (trimmed) {
    try {
      return { ok: true, json: JSON.parse(trimmed) };
    } catch {
      /* not (complete) JSON: classified below */
    }
  }

  const status = input.status;
  const code = trimmed.match(PLATFORM_ERROR_CODE)?.[1];
  const detail = [`HTTP ${status}`, code].filter(Boolean).join(", ");

  if (status === 504 || /TIMEOUT/.test(code ?? "")) {
    return { ok: false, failure: { cause: "time_limit", message: timeLimitMessage(), status, detail } };
  }
  if (status === 413 || code === "FUNCTION_PAYLOAD_TOO_LARGE") {
    return {
      ok: false,
      failure: {
        cause: "too_large",
        message:
          "Die Nachricht ist zu groß für den Server: Anhänge dürfen zusammen höchstens etwa 3 MB groß sein. Bitte kleinere oder weniger Dateien anhängen.",
        status,
        detail,
      },
    };
  }
  // A 200 holding only padding or half an object: the server stopped mid-answer.
  if (status >= 200 && status < 300 && (!trimmed || trimmed.startsWith("{"))) {
    return { ok: false, failure: { ...dtChatCutOffFailure(input.elapsedMs, detail), status } };
  }
  return {
    ok: false,
    failure: {
      cause: "server_error",
      message: `Serverfehler (HTTP ${status}${code ? `, ${code}` : ""}). Bitte erneut versuchen.`,
      status,
      detail,
    },
  };
}

/** Text for a JSON answer with `ok: false`. */
export function dtChatJsonFailureMessage(json: { message?: unknown } | null | undefined, status: number): string {
  if (typeof json?.message === "string" && json.message.trim()) return json.message;
  return status >= 400 ? `Antwort fehlgeschlagen (HTTP ${status}).` : "Antwort fehlgeschlagen.";
}

/** Text for an exception thrown outside the request itself (e.g. creating the chat). */
export function dtChatThrownFailureMessage(err: unknown): string {
  // fetch() rejects with a TypeError when the network is gone.
  if (err instanceof TypeError) return dtChatUnreachableFailure().message;
  const text = err instanceof Error && err.message.trim() ? err.message.trim() : "unbekannt";
  return `Unerwarteter Fehler im Browser (${text}). Bitte erneut versuchen.`;
}

/**
 * What the chat holds after a failed send: the server usually saved the user message
 * before the model ran, and the reply too when the connection broke only afterwards.
 */
export function dtChatStateAfterFailedSend(
  messages: Array<{ role: string; content: string }>,
  sentContent: string,
): { userSaved: boolean; replyArrived: boolean } {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  const userSaved = lastUser >= 0 && messages[lastUser]!.content.trim() === sentContent.trim();
  const replyArrived =
    userSaved && messages.slice(lastUser + 1).some((m) => m.role === "assistant" && m.content.trim());
  return { userSaved, replyArrived };
}

/** Status line under the chat after a failed send. */
export function dtChatSendFailureStatus(input: {
  message: string;
  userSaved: boolean;
  grounding: boolean;
}): string {
  const parts = [input.message];
  if (input.userSaved) parts.push("Die Nachricht bleibt im Chat.");
  if (input.grounding) parts.push("Entwurf und HTML-Datei liegen im Tab Grounding.");
  return parts.join(" ");
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === "AbortError";
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function reportFailure<T>(url: string, result: DtChatPostResult<T>): DtChatPostResult<T> {
  if (!result.ok) {
    console.error("[dt-chat] request failed", {
      url,
      cause: result.failure.cause,
      status: result.failure.status,
      detail: result.failure.detail,
    });
  }
  return result;
}

/**
 * POST JSON to a chat route and read the answer. Every failure comes back with a
 * message naming its cause; an AbortError (the Stop button) is rethrown.
 */
export async function postDtChatJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<DtChatPostResult<T>> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    const online = typeof navigator === "undefined" ? undefined : navigator.onLine;
    return reportFailure(url, { ok: false, failure: dtChatUnreachableFailure(errorText(err), online) });
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    // The connection broke while the answer was still coming.
    if (isAbortError(err)) throw err;
    const failure = dtChatCutOffFailure(Date.now() - startedAt, `HTTP ${res.status}, ${errorText(err)}`);
    return reportFailure(url, { ok: false, failure: { ...failure, status: res.status } });
  }

  const parsed = parseDtChatResponseBody({
    status: res.status,
    body: text,
    elapsedMs: Date.now() - startedAt,
  });
  if (!parsed.ok) return reportFailure(url, parsed);
  return { ok: true, status: res.status, json: parsed.json as T };
}
