import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireOnboardingAccess } from "@/lib/dt/onboarding/access";
import {
  beginOnboardingSignedUpload,
  completeOnboardingSignedUpload,
  deleteOnboardingFile,
  listOnboardingFiles,
} from "@/lib/dt/onboarding/files";
import { DT_ONBOARDING_MAX_FILE_BYTES } from "@/lib/dt/onboarding/copy";

const startSchema = z.object({
  action: z.literal("start"),
  organisationId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().positive().max(DT_ONBOARDING_MAX_FILE_BYTES),
});

const completeSchema = z.object({
  action: z.literal("complete"),
  organisationId: z.string().uuid(),
  fileId: z.string().uuid(),
  path: z.string().min(8).max(500),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().positive().max(DT_ONBOARDING_MAX_FILE_BYTES),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const orgId = new URL(req.url).searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }

  const gate = await requireOnboardingAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const files = await listOnboardingFiles(orgId);
  return NextResponse.json({ ok: true, files });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as { action?: string }).action : null;

  if (action === "start") {
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
        { status: 400 },
      );
    }
    const gate = await requireOnboardingAccess(
      auth.supabase,
      auth.userId,
      parsed.data.organisationId,
    );
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
    const started = await beginOnboardingSignedUpload({
      organisationId: parsed.data.organisationId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType ?? "",
      sizeBytes: parsed.data.sizeBytes,
    });
    if (!started.ok) {
      return NextResponse.json({ ok: false, message: started.message }, { status: 400 });
    }
    return NextResponse.json(started);
  }

  if (action === "complete") {
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
        { status: 400 },
      );
    }
    const gate = await requireOnboardingAccess(
      auth.supabase,
      auth.userId,
      parsed.data.organisationId,
    );
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
    const saved = await completeOnboardingSignedUpload({
      organisationId: parsed.data.organisationId,
      fileId: parsed.data.fileId,
      path: parsed.data.path,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType ?? "",
      sizeBytes: parsed.data.sizeBytes,
      uploadedByUserId: auth.userId,
    });
    if (!saved.ok) {
      return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, file: saved.file });
  }

  return NextResponse.json({ ok: false, message: "Unbekannte Aktion." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const orgId = url.searchParams.get("org");
  const fileId = url.searchParams.get("file");
  if (!orgId || !fileId) {
    return NextResponse.json({ ok: false, message: "Organisation oder Datei fehlt." }, { status: 400 });
  }

  const gate = await requireOnboardingAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const deleted = await deleteOnboardingFile(orgId, fileId);
  if (!deleted.ok) {
    return NextResponse.json({ ok: false, message: deleted.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
