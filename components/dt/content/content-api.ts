import type { ContentApiResponse } from "@/lib/dt/content/types";

/** Browser → `/api/dt/content/*`. Never throws; network errors become `{ ok: false }`. */
export async function contentApi<T>(
  url: string,
  init?: { method?: "GET" | "POST" | "PUT"; body?: unknown },
): Promise<ContentApiResponse<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as ContentApiResponse<T> | null;
    if (!json) return { ok: false, message: `Unerwartete Antwort (${res.status}).` };
    if (!res.ok && json.ok) return { ok: false, message: `Fehler (${res.status}).` };
    return json;
  } catch {
    return { ok: false, message: "Keine Verbindung. Bitte erneut versuchen." };
  }
}

export function contentQuery(organisationId: string): string {
  return `org=${encodeURIComponent(organisationId)}`;
}
