/**
 * Browser download of an export route (`…/export?format=…`): the response becomes a file
 * the browser saves. Shared by the Texte page drawer and the GEO tool.
 */
export async function downloadContentExport(
  url: string,
  filename: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, message: json?.message ?? "Export fehlgeschlagen." };
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return { ok: true };
  } catch {
    return { ok: false, message: "Export fehlgeschlagen." };
  }
}
