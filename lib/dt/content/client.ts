import "server-only";

const DEFAULT_TIMEOUT_MS = 20_000;

export type ContentAgentConfig = { baseUrl: string; secret: string };

/** Null means demo mode: the proxy routes answer with fixtures. */
export function contentAgentConfig(): ContentAgentConfig | null {
  const baseUrl = process.env.CONTENT_AGENT_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  return { baseUrl, secret: process.env.CONTENT_AGENT_SECRET?.trim() ?? "" };
}

export type ContentAgentResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

function messageFromBody(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown; loc?: unknown };
      const loc = Array.isArray(first?.loc) ? first.loc.join(".") : "";
      if (typeof first?.msg === "string") return loc ? `${loc}: ${first.msg}` : first.msg;
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (status === 401 || status === 403) return "Content-Agent hat den Zugriff abgelehnt.";
  if (status === 404) return "Beim Content-Agent nicht gefunden.";
  if (status === 409) return "Die Seite wird gerade bearbeitet. Bitte kurz warten.";
  return `Content-Agent antwortet mit Fehler (${status}).`;
}

function buildUrl(config: ContentAgentConfig, path: string, query?: Record<string, string>) {
  const url = new URL(`${config.baseUrl}/api/v1${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url;
}

function headers(config: ContentAgentConfig, hasBody: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Content-Agent-Secret": config.secret,
  };
  if (hasBody) h["Content-Type"] = "application/json";
  return h;
}

/** JSON call to `${CONTENT_AGENT_URL}/api/v1{path}` with the shared secret header. */
export async function contentAgentJson<T>(
  config: ContentAgentConfig,
  path: string,
  init?: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
    query?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ContentAgentResult<T>> {
  const hasBody = init?.body !== undefined;
  let res: Response;
  try {
    res = await fetch(buildUrl(config, path, init?.query), {
      method: init?.method ?? "GET",
      headers: headers(config, hasBody),
      body: hasBody ? JSON.stringify(init!.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      message: timeout
        ? "Content-Agent antwortet nicht (Zeitüberschreitung)."
        : "Content-Agent ist nicht erreichbar.",
    };
  }

  const text = await res.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: messageFromBody(body, res.status) };
  }
  return { ok: true, status: res.status, data: body as T };
}

/** Raw file download (export) — streamed back to the browser by the route. */
export async function contentAgentFile(
  config: ContentAgentConfig,
  path: string,
  query?: Record<string, string>,
): Promise<{ ok: true; response: Response } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(buildUrl(config, path, query), {
      headers: { "X-Content-Agent-Secret": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, status: res.status, message: messageFromBody(body, res.status) };
    }
    return { ok: true, response: res };
  } catch {
    return { ok: false, status: 502, message: "Content-Agent ist nicht erreichbar." };
  }
}
