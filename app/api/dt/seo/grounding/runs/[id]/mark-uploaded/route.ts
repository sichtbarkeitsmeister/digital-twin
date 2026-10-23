import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { markRunUploaded } from "@/lib/dt/seo/grounding-check/actions";
import { loadRunRow, serializeRunDetail } from "@/lib/dt/seo/grounding-check/store";
import { createServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  /** Where the page now lives, when it differs from the checked URL. */
  url: z.union([z.string().trim().url().max(2000), z.literal(""), z.null()]).optional(),
});

/**
 * The approved files are on the website (uploaded by hand). Sets the run to „uploaded“ and
 * records upload date, URL and review on the Hub, so the 3-month schedule starts again.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "URL ungültig." }, { status: 400 });
  }
  const { id } = await context.params;
  const service = createServiceClient();
  const run = await loadRunRow(service, id).catch(() => null);
  if (!run) return NextResponse.json({ ok: false, message: "Prüfung nicht gefunden." }, { status: 404 });
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, run.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  try {
    const result = await markRunUploaded(service, run, { userId: auth.userId, url: parsed.data.url || null });
    if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    return NextResponse.json({ ok: true, run: serializeRunDetail(result.value) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
