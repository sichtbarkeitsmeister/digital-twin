import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { detectGroundingPageUploadedAt } from "@/lib/dt/seo/detect-grounding-page-date";
import { evaluateGroundingPageSchedule } from "@/lib/dt/seo/grounding-page-schedule";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** Override; falls back to stored grounding_page_url. */
  url: z.string().trim().url().max(2000).optional(),
  /** Persist detected date (+ URL) on the org config. */
  apply: z.boolean().optional(),
});

const SELECT =
  "organisation_id,grounding_page_url,grounding_page_uploaded_at,grounding_page_notes";

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const orgId = parsed.data.organisationId;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { data: config, error: configError } = await auth.supabase
    .from("dt_org_config")
    .select(SELECT)
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (configError || !config) {
    return NextResponse.json(
      { ok: false, message: configError?.message ?? "Konfiguration nicht gefunden." },
      { status: 404 },
    );
  }

  const url = parsed.data.url?.trim() || config.grounding_page_url?.trim() || "";
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Bitte zuerst die URL der Grounding Page eintragen — ohne URL kann kein Datum gelesen werden.",
      },
      { status: 400 },
    );
  }

  const detected = await detectGroundingPageUploadedAt(url);
  if (!detected.ok) {
    return NextResponse.json({ ok: false, message: detected.message }, { status: 422 });
  }

  if (!parsed.data.apply) {
    return NextResponse.json({
      ok: true,
      detection: detected,
      schedule: evaluateGroundingPageSchedule({ uploadedAt: detected.detectedAt }),
    });
  }

  const noteLine = `Auto: ${detected.sourceLabel} (${new Date().toISOString().slice(0, 10)})`;
  const prevNotes = (config.grounding_page_notes ?? "").trim();
  const notes = prevNotes.includes("Auto:")
    ? prevNotes.replace(/^Auto:.*$/m, noteLine).trim()
    : [prevNotes, noteLine].filter(Boolean).join("\n");

  const { data: updated, error: updateError } = await auth.supabase
    .from("dt_org_config")
    .update({
      grounding_page_url: detected.finalUrl || url,
      grounding_page_uploaded_at: detected.detectedAt,
      grounding_page_notes: notes || null,
    })
    .eq("organisation_id", orgId)
    .select(SELECT)
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      { ok: false, message: updateError?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    detection: detected,
    grounding: {
      organisationId: updated.organisation_id,
      url: updated.grounding_page_url,
      uploadedAt: updated.grounding_page_uploaded_at,
      notes: updated.grounding_page_notes,
      schedule: evaluateGroundingPageSchedule({
        uploadedAt: updated.grounding_page_uploaded_at,
      }),
    },
  });
}
