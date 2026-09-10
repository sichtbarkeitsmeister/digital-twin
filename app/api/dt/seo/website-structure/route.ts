import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { parseWebsiteStructure, clipWebsiteStructureRaw } from "@/lib/dt/seo/website-structure";
import { createServiceClient } from "@/lib/supabase/service";

const SELECT =
  "organisation_id,filename,mime_type,raw_text,outline,node_count,notes,uploaded_at,uploaded_by";

const putSchema = z.object({
  organisationId: z.string().uuid(),
  text: z.string().min(1).max(220_000),
  filename: z.string().trim().max(240).nullable().optional(),
  mimeType: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function serialize(row: {
  organisation_id: string;
  filename: string | null;
  mime_type: string | null;
  outline: string;
  node_count: number;
  notes: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  raw_text?: string;
}) {
  return {
    organisationId: row.organisation_id,
    filename: row.filename,
    mimeType: row.mime_type,
    outline: row.outline,
    nodeCount: row.node_count,
    notes: row.notes,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    rawText: row.raw_text,
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

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_website_structures")
    .select(SELECT)
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    structure: data ? serialize(data) : null,
  });
}

export async function PUT(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ungültige Anfrage." }, { status: 400 });
  }

  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Struktur-Daten." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  let structure;
  try {
    structure = parseWebsiteStructure(parsed.data.text);
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Struktur konnte nicht gelesen werden." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const row = {
    organisation_id: parsed.data.organisationId,
    filename: parsed.data.filename?.trim() || null,
    mime_type: parsed.data.mimeType?.trim() || null,
    raw_text: clipWebsiteStructureRaw(parsed.data.text),
    outline: structure.outline,
    node_count: structure.nodeCount,
    notes: parsed.data.notes?.trim() || null,
    uploaded_at: new Date().toISOString(),
    uploaded_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("dt_website_structures")
    .upsert(row, { onConflict: "organisation_id" })
    .select(SELECT)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Struktur konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    structure: serialize(data),
    format: structure.format,
    truncated: structure.truncated,
  });
}

export async function DELETE(req: Request) {
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

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("dt_website_structures")
    .delete()
    .eq("organisation_id", orgId);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
