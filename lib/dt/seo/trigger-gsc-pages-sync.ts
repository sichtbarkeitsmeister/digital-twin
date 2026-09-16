import "server-only";

export async function triggerGscPagesSync(input: {
  organisationId: string;
  crawlId?: string | null;
}): Promise<{ ok: boolean; skipped?: boolean; message: string }> {
  const webhook = process.env.N8N_DT_GSC_PAGES_WEBHOOK?.trim();
  if (!webhook) {
    return {
      ok: true,
      skipped: true,
      message: "GSC-Seiten-Sync ist nicht angebunden (N8N_DT_GSC_PAGES_WEBHOOK fehlt).",
    };
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: input.organisationId,
        crawlId: input.crawlId ?? undefined,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        message: `GSC-Seiten-Sync fehlgeschlagen (${res.status}): ${text || "unbekannt"}`,
      };
    }
    return { ok: true, message: "GSC-Seiten-Abgleich gestartet." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "GSC-Seiten-Sync fehlgeschlagen.";
    return { ok: false, message };
  }
}
