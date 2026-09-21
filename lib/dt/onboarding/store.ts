import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_ONBOARDING_RECORD,
  type DtOnboardingRecord,
} from "@/lib/dt/onboarding/copy";
import {
  normalizeOnboardingRecord,
  onboardingRecordFromRow,
  onboardingRowFromRecord,
} from "@/lib/dt/onboarding/normalize";
import {
  generateOnboardingUploadPassword,
  generateOnboardingUploadToken,
} from "@/lib/dt/onboarding/secrets";
import { createServiceClient } from "@/lib/supabase/service";

const ONBOARDING_SELECT =
  "organisation_id, upload_token, upload_password, hoster_user, hoster_password, smtp_host, smtp_port, smtp_protocol, smtp_username, smtp_password, cms_login_url, cms_user, cms_password, competitors, billing_email, customer_contacts, additional_info, updated_at, updated_by_user_id";

type OnboardingRow = {
  organisation_id: string;
  upload_token: string;
  upload_password: string;
  hoster_user: string | null;
  hoster_password: string | null;
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_protocol: string | null;
  smtp_username: string | null;
  smtp_password: string | null;
  cms_login_url: string | null;
  cms_user: string | null;
  cms_password: string | null;
  competitors: unknown;
  billing_email: string | null;
  customer_contacts: unknown;
  additional_info: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
};

function db(client?: SupabaseClient) {
  return client ?? createServiceClient();
}

export async function loadOnboarding(
  organisationId: string,
  client?: SupabaseClient,
): Promise<{
  record: DtOnboardingRecord;
  updatedAt: string | null;
  exists: boolean;
}> {
  const supabase = db(client);
  const { data, error } = await supabase
    .from("dt_org_onboarding")
    .select(ONBOARDING_SELECT)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (error) {
    console.error("[onboarding] load:", error.message);
    return { record: EMPTY_ONBOARDING_RECORD, updatedAt: null, exists: false };
  }

  const row = data as OnboardingRow | null;
  if (!row) {
    return { record: EMPTY_ONBOARDING_RECORD, updatedAt: null, exists: false };
  }

  return {
    record: onboardingRecordFromRow(row),
    updatedAt: row.updated_at,
    exists: true,
  };
}

export async function ensureOnboarding(
  organisationId: string,
  userId: string,
  client?: SupabaseClient,
): Promise<{
  record: DtOnboardingRecord;
  updatedAt: string | null;
  created: boolean;
}> {
  const loaded = await loadOnboarding(organisationId, client);
  if (loaded.exists && loaded.record.uploadToken && loaded.record.uploadPassword) {
    return { record: loaded.record, updatedAt: loaded.updatedAt, created: false };
  }

  const supabase = db(client);
  const token = loaded.record.uploadToken || generateOnboardingUploadToken();
  const password = loaded.record.uploadPassword || generateOnboardingUploadPassword();
  const record = normalizeOnboardingRecord({
    ...loaded.record,
    uploadToken: token,
    uploadPassword: password,
  });

  const { data, error } = await supabase
    .from("dt_org_onboarding")
    .upsert(
      {
        organisation_id: organisationId,
        ...onboardingRowFromRecord(record),
        updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organisation_id" },
    )
    .select(ONBOARDING_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[onboarding] ensure:", error.message);
    return { record, updatedAt: loaded.updatedAt, created: !loaded.exists };
  }

  const row = data as OnboardingRow | null;
  return {
    record: row ? onboardingRecordFromRow(row) : record,
    updatedAt: row?.updated_at ?? new Date().toISOString(),
    created: !loaded.exists,
  };
}

export async function saveOnboarding(input: {
  organisationId: string;
  record: DtOnboardingRecord;
  userId: string;
  regenerateUpload?: boolean;
  client?: SupabaseClient;
}): Promise<{ ok: true; record: DtOnboardingRecord; updatedAt: string } | { ok: false; message: string }> {
  const supabase = db(input.client);
  const existing = await loadOnboarding(input.organisationId, input.client);

  let uploadToken = existing.record.uploadToken || generateOnboardingUploadToken();
  let uploadPassword = existing.record.uploadPassword || generateOnboardingUploadPassword();
  if (input.regenerateUpload) {
    uploadToken = generateOnboardingUploadToken();
    uploadPassword = generateOnboardingUploadPassword();
  }

  const record = normalizeOnboardingRecord({
    ...input.record,
    uploadToken,
    uploadPassword,
  });

  const { data, error } = await supabase
    .from("dt_org_onboarding")
    .upsert(
      {
        organisation_id: input.organisationId,
        ...onboardingRowFromRecord(record),
        updated_by_user_id: input.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organisation_id" },
    )
    .select(ONBOARDING_SELECT)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || "Onboarding konnte nicht gespeichert werden." };
  }

  const row = data as OnboardingRow | null;
  return {
    ok: true,
    record: row ? onboardingRecordFromRow(row) : record,
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

export async function loadOnboardingByUploadToken(token: string): Promise<{
  organisationId: string;
  record: DtOnboardingRecord;
} | null> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 16) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_org_onboarding")
    .select(ONBOARDING_SELECT)
    .eq("upload_token", trimmed)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as OnboardingRow;
  return {
    organisationId: row.organisation_id,
    record: onboardingRecordFromRow(row),
  };
}

export async function countOnboardingFiles(
  organisationId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = db(client);
  const { count, error } = await supabase
    .from("dt_org_onboarding_files")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId);
  if (error) {
    console.error("[onboarding] count files:", error.message);
    return 0;
  }
  return count ?? 0;
}
