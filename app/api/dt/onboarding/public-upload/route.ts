import { NextResponse } from "next/server";
import { z } from "zod";

import { DT_ONBOARDING_MAX_FILE_BYTES } from "@/lib/dt/onboarding/copy";
import {
  beginOnboardingSignedUpload,
  completeOnboardingSignedUpload,
} from "@/lib/dt/onboarding/files";
import { onboardingPasswordsMatch } from "@/lib/dt/onboarding/secrets";
import { loadOnboardingByUploadToken } from "@/lib/dt/onboarding/store";

const startSchema = z.object({
  action: z.literal("start"),
  token: z.string().min(16).max(64),
  password: z.string().min(1).max(80),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().positive().max(DT_ONBOARDING_MAX_FILE_BYTES),
});

const completeSchema = z.object({
  action: z.literal("complete"),
  token: z.string().min(16).max(64),
  password: z.string().min(1).max(80),
  fileId: z.string().uuid(),
  path: z.string().min(8).max(500),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().positive().max(DT_ONBOARDING_MAX_FILE_BYTES),
});

async function orgForPassword(token: string, password: string) {
  const found = await loadOnboardingByUploadToken(token);
  if (!found || !onboardingPasswordsMatch(password, found.record.uploadPassword)) {
    return null;
  }
  return found;
}

export async function POST(req: Request) {
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
    const found = await orgForPassword(parsed.data.token, parsed.data.password);
    if (!found) {
      return NextResponse.json(
        { ok: false, message: "Passwort oder Link ist nicht korrekt." },
        { status: 401 },
      );
    }
    const started = await beginOnboardingSignedUpload({
      organisationId: found.organisationId,
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
    const found = await orgForPassword(parsed.data.token, parsed.data.password);
    if (!found) {
      return NextResponse.json(
        { ok: false, message: "Passwort oder Link ist nicht korrekt." },
        { status: 401 },
      );
    }
    const saved = await completeOnboardingSignedUpload({
      organisationId: found.organisationId,
      fileId: parsed.data.fileId,
      path: parsed.data.path,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType ?? "",
      sizeBytes: parsed.data.sizeBytes,
      uploadedByUserId: null,
    });
    if (!saved.ok) {
      return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, fileName: saved.file.fileName });
  }

  return NextResponse.json({ ok: false, message: "Unbekannte Aktion." }, { status: 400 });
}
