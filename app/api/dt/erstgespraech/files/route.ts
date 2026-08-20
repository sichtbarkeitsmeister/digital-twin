import { NextResponse } from "next/server";
import { z } from "zod";

import { fillFirstConversationFromDocuments } from "@/lib/surveys/first-conversation-ai";
import {
  deleteFirstConversationFile,
  listFirstConversationFiles,
  loadFirstConversationDocumentText,
  uploadFirstConversationFile,
} from "@/lib/surveys/first-conversation-files";
import {
  loadFirstConversation,
  saveFirstConversation,
} from "@/lib/surveys/first-conversation-store";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return { ok: false as const, message: "Nicht angemeldet.", status: 401 };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return { ok: false as const, message: "Nur Plattform-Admins.", status: 403 };
  }
  return { ok: true as const, userId: user.id };
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, message: "Ungültiger Upload." }, { status: 400 });
  }
  const organisationId = String(form.get("organisationId") ?? "");
  const parsedOrg = z.string().uuid().safeParse(organisationId);
  if (!parsedOrg.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "Keine Datei." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await uploadFirstConversationFile({
    organisationId: parsedOrg.data,
    userId: auth.userId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    bytes,
  });
  if (!uploaded.ok) {
    return NextResponse.json({ ok: false, message: uploaded.message }, { status: 400 });
  }

  const documentText = await loadFirstConversationDocumentText(parsedOrg.data);
  const current = await loadFirstConversation(parsedOrg.data);
  const filled = await fillFirstConversationFromDocuments({
    record: current.record,
    documentText,
  });
  await saveFirstConversation({
    organisationId: parsedOrg.data,
    record: filled.record,
    userId: auth.userId,
  });

  const files = await listFirstConversationFiles(parsedOrg.data);
  return NextResponse.json({
    ok: true,
    file: uploaded.file,
    extractWarning: uploaded.extractWarning,
    filledKeys: filled.filledKeys,
    record: filled.record,
    files,
  });
}

export async function DELETE(req: Request) {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  }
  const url = new URL(req.url);
  const organisationId = url.searchParams.get("org") ?? "";
  const fileId = url.searchParams.get("fileId") ?? "";
  const parsed = z
    .object({ organisationId: z.string().uuid(), fileId: z.string().uuid() })
    .safeParse({ organisationId, fileId });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Angabe." }, { status: 400 });
  }
  const deleted = await deleteFirstConversationFile(parsed.data);
  if (!deleted.ok) {
    return NextResponse.json({ ok: false, message: deleted.message }, { status: 400 });
  }
  const files = await listFirstConversationFiles(parsed.data.organisationId);
  return NextResponse.json({ ok: true, files });
}
