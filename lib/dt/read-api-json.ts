/** Parse a chat API response. Non-JSON platform errors become a German message. */
export async function readDtApiJson<T>(res: Response): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(nonJsonMessage(res.status));
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(nonJsonMessage(res.status));
  }
}

function nonJsonMessage(status: number): string {
  if (status === 413) {
    return "Die Datei ist zu groß für den direkten Upload. Bitte erneut versuchen.";
  }
  if (status === 502 || status === 504) {
    return "Die Anfrage hat zu lange gedauert. Bitte eine kleinere Datei versuchen.";
  }
  return "Netzwerkfehler — bitte erneut versuchen.";
}
