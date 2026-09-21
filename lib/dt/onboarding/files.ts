import "server-only";

import { sanitizeStorageFileSegment } from "@/lib/ai/chat-attachments";
import {
  DT_ONBOARDING_MAX_FILE_BYTES,
  DT_ONBOARDING_MAX_FILES,
  type DtOnboardingFileRow,
} from "@/lib/dt/onboarding/copy";
import {
  DT_ONBOARDING_ALLOWED_MIMES,
  guessOnboardingMime,
  isOnboardingImageMime,
  isOnboardingVideoMime,
} from "@/lib/dt/onboarding/mime";
import { createServiceClient } from "@/lib/supabase/service";

export const DT_ONBOARDING_UPLOADS_BUCKET = "dt-onboarding-uploads";
export { guessOnboardingMime, DT_ONBOARDING_ALLOWED_MIMES } from "@/lib/dt/onboarding/mime";

export function onboardingFileStoragePath(params: {
  organisationId: string;
  fileId: string;
  fileName: string;
}): string {
  const safe = sanitizeStorageFileSegment(params.fileName);
  return `org_${params.organisationId}/${params.fileId}_${safe}`;
}

export async function validateOnboardingUploadMeta(input: {
  organisationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ ok: true; mime: string } | { ok: false; message: string }> {
  if (input.sizeBytes <= 0) {
    return { ok: false, message: "Die Datei ist leer." };
  }
  if (input.sizeBytes > DT_ONBOARDING_MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `„${input.fileName}“ ist zu groß (max. ${Math.round(DT_ONBOARDING_MAX_FILE_BYTES / (1024 * 1024))} MB).`,
    };
  }
  const mime = guessOnboardingMime(input.fileName, input.mimeType);
  if (!mime || !DT_ONBOARDING_ALLOWED_MIMES.has(mime)) {
    return {
      ok: false,
      message: `„${input.fileName}“ hat einen nicht erlaubten Dateityp. Erlaubt: Bilder, Videos, PDF, SVG.`,
    };
  }
  const supabase = createServiceClient();
  const { count } = await supabase
    .from("dt_org_onboarding_files")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", input.organisationId);
  if ((count ?? 0) >= DT_ONBOARDING_MAX_FILES) {
    return {
      ok: false,
      message: `Es sind höchstens ${DT_ONBOARDING_MAX_FILES} Dateien möglich.`,
    };
  }
  return { ok: true, mime };
}

export async function beginOnboardingSignedUpload(input: {
  organisationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<
  | {
      ok: true;
      fileId: string;
      path: string;
      signedUrl: string;
      token: string;
      mimeType: string;
    }
  | { ok: false; message: string }
> {
  const validated = await validateOnboardingUploadMeta(input);
  if (!validated.ok) return validated;

  const fileId = crypto.randomUUID();
  const storagePath = onboardingFileStoragePath({
    organisationId: input.organisationId,
    fileId,
    fileName: input.fileName,
  });
  const supabase = createServiceClient();
  const signed = await supabase.storage
    .from(DT_ONBOARDING_UPLOADS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signed.error || !signed.data?.signedUrl || !signed.data.token) {
    return {
      ok: false,
      message: signed.error?.message || "Upload-Link konnte nicht erzeugt werden.",
    };
  }
  return {
    ok: true,
    fileId,
    path: storagePath,
    signedUrl: signed.data.signedUrl,
    token: signed.data.token,
    mimeType: validated.mime,
  };
}

export async function completeOnboardingSignedUpload(input: {
  organisationId: string;
  fileId: string;
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
}): Promise<{ ok: true; file: DtOnboardingFileRow } | { ok: false; message: string }> {
  const expectedPath = onboardingFileStoragePath({
    organisationId: input.organisationId,
    fileId: input.fileId,
    fileName: input.fileName,
  });
  if (input.path !== expectedPath) {
    return { ok: false, message: "Ungültiger Upload-Pfad." };
  }

  const validated = await validateOnboardingUploadMeta({
    organisationId: input.organisationId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
  if (!validated.ok) return validated;

  const supabase = createServiceClient();
  const exists = await supabase.storage
    .from(DT_ONBOARDING_UPLOADS_BUCKET)
    .createSignedUrl(expectedPath, 30);
  if (exists.error || !exists.data?.signedUrl) {
    return { ok: false, message: "Die Datei ist noch nicht in der Cloud angekommen." };
  }

  const { data, error } = await supabase
    .from("dt_org_onboarding_files")
    .insert({
      id: input.fileId,
      organisation_id: input.organisationId,
      storage_path: expectedPath,
      file_name: input.fileName.slice(0, 255),
      mime_type: validated.mime,
      size_bytes: input.sizeBytes,
      uploaded_by_user_id: input.uploadedByUserId,
    })
    .select("id, file_name, mime_type, size_bytes, created_at")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      message: error?.message || "Datei konnte nicht gespeichert werden.",
    };
  }

  return {
    ok: true,
    file: {
      id: data.id,
      fileName: data.file_name,
      mimeType: data.mime_type,
      sizeBytes: data.size_bytes,
      createdAt: data.created_at,
    },
  };
}

export async function listOnboardingFiles(
  organisationId: string,
): Promise<DtOnboardingFileRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_org_onboarding_files")
    .select("id, file_name, mime_type, size_bytes, created_at, storage_path")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[onboarding] list files:", error.message);
    return [];
  }

  const rows = data ?? [];
  const previewPaths = rows
    .filter((row) => isOnboardingImageMime(row.mime_type) || isOnboardingVideoMime(row.mime_type))
    .map((row) => row.storage_path);
  const previewByPath = new Map<string, string>();
  if (previewPaths.length > 0) {
    const signed = await supabase.storage
      .from(DT_ONBOARDING_UPLOADS_BUCKET)
      .createSignedUrls(previewPaths, 3600);
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl && !item.error) {
        previewByPath.set(item.path, item.signedUrl);
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    previewUrl: previewByPath.get(row.storage_path) ?? null,
  }));
}

export async function createOnboardingFileSignedUrl(
  organisationId: string,
  fileId: string,
): Promise<{ ok: true; url: string; fileName: string } | { ok: false; message: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_org_onboarding_files")
    .select("storage_path, file_name")
    .eq("id", fileId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "Datei nicht gefunden." };
  }
  const signed = await supabase.storage
    .from(DT_ONBOARDING_UPLOADS_BUCKET)
    .createSignedUrl(data.storage_path, 300);
  if (signed.error || !signed.data?.signedUrl) {
    return { ok: false, message: "Download-Link konnte nicht erzeugt werden." };
  }
  return { ok: true, url: signed.data.signedUrl, fileName: data.file_name };
}

export async function deleteOnboardingFile(
  organisationId: string,
  fileId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_org_onboarding_files")
    .select("storage_path")
    .eq("id", fileId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "Datei nicht gefunden." };
  }
  await supabase.storage.from(DT_ONBOARDING_UPLOADS_BUCKET).remove([data.storage_path]);
  const { error: delErr } = await supabase
    .from("dt_org_onboarding_files")
    .delete()
    .eq("id", fileId)
    .eq("organisation_id", organisationId);
  if (delErr) {
    return { ok: false, message: delErr.message || "Datei konnte nicht gelöscht werden." };
  }
  return { ok: true };
}
