import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { evaluateGroundingPageSchedule } from "@/lib/dt/seo/grounding-page-schedule";

const SELECT =
  "organisation_id,grounding_page_url,grounding_page_uploaded_at,grounding_page_notes";

const patchSchema = z.object({
  organisationId: z.string().uuid(),
  uploadedAt: z
    .union([
      z.string().datetime({ offset: true }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum ungültig"),
      z.null(),
    ])
    .transform((v) => {
      if (v == null) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T12:00:00.000Z`;
      return v;
    }),
  url: z
    .union([z.string().trim().url().max(2000), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function serialize(row: {
  organisation_id: string;
  grounding_page_url: string | null;
  grounding_page_uploaded_at: string | null;
  grounding_page_notes: string | null;
}) {
  const schedule = evaluateGroundingPageSchedule({
    uploadedAt: row.grounding_page_uploaded_at,
  });
  return {
    organisationId: row.organisation_id,
    url: row.grounding_page_url,
    uploadedAt: row.grounding_page_uploaded_at,
    notes: row.grounding_page_notes,
    schedule,
  };
}

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const orgId = new URL(req.url).searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { data, error } = await auth.supabase
    .from("dt_org_config")
    .select(SELECT)
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Konfiguration nicht gefunden." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, grounding: serialize(data) });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
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

  const patch: Record<string, unknown> = {
    grounding_page_uploaded_at: parsed.data.uploadedAt,
  };
  if (parsed.data.url !== undefined) patch.grounding_page_url = parsed.data.url;
  if (parsed.data.notes !== undefined) {
    patch.grounding_page_notes = parsed.data.notes?.trim() || null;
  }

  const { data, error } = await auth.supabase
    .from("dt_org_config")
    .update(patch)
    .eq("organisation_id", orgId)
    .select(SELECT)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, grounding: serialize(data) });
}
