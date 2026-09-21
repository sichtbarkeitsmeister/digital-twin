"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireOnboardingAccess } from "@/lib/dt/onboarding/access";
import {
  DT_ONBOARDING_ADDITIONAL_INFO_MAX,
  DT_ONBOARDING_MAX_COMPETITORS,
  DT_ONBOARDING_MAX_CUSTOMER_CONTACTS,
  type DtOnboardingRecord,
} from "@/lib/dt/onboarding/copy";
import {
  normalizeOnboardingRecord,
  validateOnboardingRecord,
} from "@/lib/dt/onboarding/normalize";
import { ensureOnboarding, saveOnboarding } from "@/lib/dt/onboarding/store";

export type OnboardingActionState<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

const recordSchema = z.object({
  uploadToken: z.string().max(64),
  uploadPassword: z.string().max(80),
  hosterUser: z.string().max(200),
  hosterPassword: z.string().max(200),
  smtpHost: z.string().max(200),
  smtpPort: z.string().max(12),
  smtpProtocol: z.string().max(40),
  smtpUsername: z.string().max(200),
  smtpPassword: z.string().max(200),
  cmsLoginUrl: z.string().max(500),
  cmsUser: z.string().max(200),
  cmsPassword: z.string().max(200),
  competitors: z.array(z.string().max(200)).max(DT_ONBOARDING_MAX_COMPETITORS),
  billingEmail: z.string().max(200),
  customerContacts: z
    .array(
      z.object({
        name: z.string().max(120),
        role: z.string().max(120),
        email: z.string().max(200),
        phone: z.string().max(80),
      }),
    )
    .max(DT_ONBOARDING_MAX_CUSTOMER_CONTACTS),
  additionalInfo: z.string().max(DT_ONBOARDING_ADDITIONAL_INFO_MAX),
});

async function requireOnboardingUser(organisationId: string) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return { ok: false as const, message: "Nicht angemeldet.", userId: null, supabase: auth.supabase };
  }
  const gate = await requireOnboardingAccess(auth.supabase, auth.userId, organisationId);
  if (!gate.ok) {
    return { ok: false as const, message: gate.message, userId: null, supabase: auth.supabase };
  }
  return { ok: true as const, message: "ok", userId: auth.userId, supabase: auth.supabase };
}

export async function loadOnboardingAction(input: {
  organisationId: string;
}): Promise<
  OnboardingActionState<{
    record: DtOnboardingRecord;
    updatedAt: string | null;
  }>
> {
  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const auth = await requireOnboardingUser(parsed.data.organisationId);
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const ensured = await ensureOnboarding(parsed.data.organisationId, auth.userId);
  return {
    ok: true,
    message: "ok",
    data: { record: ensured.record, updatedAt: ensured.updatedAt },
  };
}

export async function saveOnboardingAction(input: {
  organisationId: string;
  record: DtOnboardingRecord;
  regenerateUpload?: boolean;
}): Promise<
  OnboardingActionState<{ record: DtOnboardingRecord; updatedAt: string }>
> {
  const parsed = z
    .object({
      organisationId: z.string().uuid(),
      record: recordSchema,
      regenerateUpload: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requireOnboardingUser(parsed.data.organisationId);
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const record = normalizeOnboardingRecord(parsed.data.record);
  const invalid = validateOnboardingRecord(record);
  if (invalid) return { ok: false, message: invalid };

  const saved = await saveOnboarding({
    organisationId: parsed.data.organisationId,
    record,
    userId: auth.userId,
    regenerateUpload: parsed.data.regenerateUpload === true,
  });
  if (!saved.ok) return { ok: false, message: saved.message };

  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard/organisations");

  return {
    ok: true,
    message: parsed.data.regenerateUpload
      ? "Neuer Upload-Link und neues Passwort erzeugt."
      : "Onboarding gespeichert.",
    data: { record: saved.record, updatedAt: saved.updatedAt },
  };
}
