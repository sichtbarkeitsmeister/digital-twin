"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  EMPTY_FIRST_CONVERSATION,
  firstConversationHasContent,
  normalizeFirstConversation,
  prepareFirstConversationForSave,
  type FirstConversationFileMeta,
  type FirstConversationRecord,
} from "@/lib/surveys/first-conversation";
import { fillFirstConversationFromDocuments } from "@/lib/surveys/first-conversation-ai";
import {
  listFirstConversationFiles,
  loadFirstConversationDocumentText,
} from "@/lib/surveys/first-conversation-files";
import {
  loadFirstConversation,
  saveFirstConversation,
} from "@/lib/surveys/first-conversation-store";
import { createClient } from "@/lib/supabase/server";

export type ActionState<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return { ok: false as const, message: "Nicht angemeldet.", userId: null };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return { ok: false as const, message: "Nur Plattform-Admins.", userId: null };
  }
  return { ok: true as const, message: "ok", userId: user.id };
}

const recordSchema = z.object(
  Object.fromEntries(
    Object.keys(EMPTY_FIRST_CONVERSATION).map((key) => [key, z.string().max(8000)]),
  ) as Record<keyof FirstConversationRecord, z.ZodString>,
);

export async function loadErstgespraechAction(input: {
  organisationId: string;
}): Promise<
  ActionState<{
    record: FirstConversationRecord;
    updatedAt: string | null;
    hasContent: boolean;
    files: FirstConversationFileMeta[];
  }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const [loaded, files] = await Promise.all([
    loadFirstConversation(parsed.data.organisationId),
    listFirstConversationFiles(parsed.data.organisationId),
  ]);
  return {
    ok: true,
    message: "ok",
    data: {
      record: loaded.record,
      updatedAt: loaded.updatedAt,
      hasContent: firstConversationHasContent(loaded.record),
      files,
    },
  };
}

export async function saveErstgespraechAction(input: {
  organisationId: string;
  record: FirstConversationRecord;
}): Promise<ActionState<{ updatedAt: string }>> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const parsed = z
    .object({
      organisationId: z.string().uuid(),
      record: recordSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const record = prepareFirstConversationForSave(parsed.data.record);
  const saved = await saveFirstConversation({
    organisationId: parsed.data.organisationId,
    record,
    userId: auth.userId,
  });
  if (!saved.ok) return { ok: false, message: saved.message };

  revalidatePath("/dashboard/erstgespraech");
  revalidatePath("/dashboard/frageboegen");
  revalidatePath("/dashboard/frageboegen/neu");

  return {
    ok: true,
    message: firstConversationHasContent(record)
      ? "Erstgespräch gespeichert."
      : "Leeres Erstgespräch gespeichert.",
    data: { updatedAt: new Date().toISOString() },
  };
}

export async function fillErstgespraechFromFilesAction(input: {
  organisationId: string;
  record: FirstConversationRecord;
}): Promise<
  ActionState<{ record: FirstConversationRecord; filledKeys: string[]; updatedAt: string }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const parsed = z
    .object({
      organisationId: z.string().uuid(),
      record: recordSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const documentText = await loadFirstConversationDocumentText(parsed.data.organisationId);
  if (!documentText.trim()) {
    return { ok: false, message: "Keine lesbaren Dateien vorhanden." };
  }

  const filled = await fillFirstConversationFromDocuments({
    record: normalizeFirstConversation(parsed.data.record),
    documentText,
  });
  const record = prepareFirstConversationForSave(filled.record);
  const saved = await saveFirstConversation({
    organisationId: parsed.data.organisationId,
    record,
    userId: auth.userId,
  });
  if (!saved.ok) return { ok: false, message: saved.message };

  revalidatePath("/dashboard/erstgespraech");
  revalidatePath("/dashboard/frageboegen/neu");
  return {
    ok: true,
    message:
      filled.filledKeys.length > 0
        ? `${filled.filledKeys.length} Felder aus den Dateien vorausgefüllt.`
        : "In den Dateien stand nichts Neues für leere Felder.",
    data: {
      record,
      filledKeys: filled.filledKeys,
      updatedAt: new Date().toISOString(),
    },
  };
}
