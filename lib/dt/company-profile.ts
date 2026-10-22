/**
 * Customer Firmenprofil: org stammdaten + Ansprechpartner + Anbieter-Punkte.
 * Edits apply immediately and are logged so staff can see what changed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DT_ONBOARDING_MAX_CUSTOMER_CONTACTS,
  EMPTY_CUSTOMER_CONTACT,
  type DtOnboardingCustomerContact,
} from "@/lib/dt/onboarding/copy";
import {
  ANBIETER_POINTS,
  type AnbieterItem,
  type AnbieterPointKey,
  type AnbieterState,
  normalizeAnbieterItems,
} from "@/lib/dt/transcripts/workshop-model";
import { loadWorkshopState, saveAnbieterState, syncAnbieterToSeoAdvisor } from "@/lib/dt/transcripts/workshop-store";

export type CompanyProfileContact = DtOnboardingCustomerContact;

export type CompanyProfileChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

export type CompanyProfileEditRow = {
  id: string;
  organisation_id: string;
  edited_by_user_id: string;
  changes: CompanyProfileChange[];
  note: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  created_at: string;
};

export type CompanyProfileEditView = CompanyProfileEditRow & {
  organisation_name?: string;
  editor_email?: string | null;
};

export type CompanyProfile = {
  organisationId: string;
  organisationName: string;
  displayName: string;
  websiteUrl: string;
  contacts: CompanyProfileContact[];
  points: AnbieterItem[];
  anbieterStatus: AnbieterState["status"];
  canEdit: boolean;
};

const EDIT_SELECT =
  "id,organisation_id,edited_by_user_id,changes,note,reviewed_at,reviewed_by_user_id,created_at";

const POINT_LABEL = new Map(ANBIETER_POINTS.map((point) => [point.key, point.label]));

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function contactsEqual(a: CompanyProfileContact[], b: CompanyProfileContact[]): boolean {
  return serializeContacts(a) === serializeContacts(b);
}

export function normalizeProfileContacts(value: unknown): CompanyProfileContact[] {
  const raw = Array.isArray(value) ? value : [];
  const cleaned: CompanyProfileContact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const contact: CompanyProfileContact = {
      name: clip(typeof row.name === "string" ? row.name : "", 120),
      role: clip(typeof row.role === "string" ? row.role : "", 120),
      email: clip(typeof row.email === "string" ? row.email : "", 200),
      phone: clip(typeof row.phone === "string" ? row.phone : "", 80),
    };
    if (!contact.name && !contact.role && !contact.email && !contact.phone) continue;
    cleaned.push(contact);
    if (cleaned.length >= DT_ONBOARDING_MAX_CUSTOMER_CONTACTS) break;
  }
  while (cleaned.length < DT_ONBOARDING_MAX_CUSTOMER_CONTACTS) {
    cleaned.push({ ...EMPTY_CUSTOMER_CONTACT });
  }
  return cleaned;
}

export function serializeContacts(contacts: CompanyProfileContact[]): string {
  return contacts
    .filter((c) => c.name || c.role || c.email || c.phone)
    .map((c) => [c.name, c.role, c.email, c.phone].filter(Boolean).join(" · "))
    .join("\n");
}

export function buildCompanyProfileChanges(input: {
  before: {
    displayName: string;
    websiteUrl: string;
    contacts: CompanyProfileContact[];
    points: AnbieterItem[];
  };
  after: {
    displayName: string;
    websiteUrl: string;
    contacts: CompanyProfileContact[];
    points: AnbieterItem[];
  };
}): CompanyProfileChange[] {
  const changes: CompanyProfileChange[] = [];
  if (input.before.displayName !== input.after.displayName) {
    changes.push({
      key: "display_name",
      label: "Anzeigename",
      before: input.before.displayName,
      after: input.after.displayName,
    });
  }
  if (input.before.websiteUrl !== input.after.websiteUrl) {
    changes.push({
      key: "website_url",
      label: "Website",
      before: input.before.websiteUrl,
      after: input.after.websiteUrl,
    });
  }
  if (!contactsEqual(input.before.contacts, input.after.contacts)) {
    changes.push({
      key: "contacts",
      label: "Ansprechpartner",
      before: serializeContacts(input.before.contacts),
      after: serializeContacts(input.after.contacts),
    });
  }
  const beforeByKey = new Map(input.before.points.map((item) => [item.key, item.current]));
  for (const point of ANBIETER_POINTS) {
    const before = (beforeByKey.get(point.key) ?? "").trim();
    const afterItem = input.after.points.find((item) => item.key === point.key);
    const after = (afterItem?.current ?? "").trim();
    if (before === after) continue;
    changes.push({
      key: `anbieter.${point.key}`,
      label: point.label,
      before,
      after,
    });
  }
  return changes;
}

function normalizeIncomingPoints(
  raw: unknown,
  previous: AnbieterItem[],
): AnbieterItem[] {
  const previousByKey = new Map(previous.map((item) => [item.key, item]));
  const incoming = Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, string>();
  for (const row of incoming) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : "";
    if (!POINT_LABEL.has(key as AnbieterPointKey)) continue;
    const current = typeof record.current === "string" ? record.current.trim().slice(0, 8_000) : "";
    byKey.set(key, current);
  }
  return ANBIETER_POINTS.map((point) => {
    const prev = previousByKey.get(point.key);
    const nextCurrent = byKey.has(point.key) ? byKey.get(point.key)! : (prev?.current ?? "");
    return {
      key: point.key,
      label: point.label,
      current: nextCurrent,
      earlier: prev?.earlier ?? null,
      sources: prev?.sources ?? "",
    };
  });
}

export async function loadCompanyProfile(
  supabase: SupabaseClient,
  organisationId: string,
  canEdit: boolean,
): Promise<CompanyProfile | null> {
  const [{ data: org }, { data: config }, workshop, { data: onboarding }] = await Promise.all([
    supabase.from("organisations").select("id,name").eq("id", organisationId).maybeSingle(),
    supabase
      .from("dt_org_config")
      .select("display_name,website_url")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    loadWorkshopState(supabase, organisationId),
    supabase
      .from("dt_org_onboarding")
      .select("customer_contacts")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);

  if (!org) return null;

  const organisationName = org.name?.trim() || "Organisation";
  const displayName = config?.display_name?.trim() || organisationName;
  const websiteUrl = config?.website_url?.trim() || "";
  const points =
    workshop.anbieter.items.length > 0
      ? workshop.anbieter.items
      : normalizeAnbieterItems([]);

  return {
    organisationId,
    organisationName,
    displayName,
    websiteUrl,
    contacts: normalizeProfileContacts(onboarding?.customer_contacts),
    points,
    anbieterStatus: workshop.anbieter.status,
    canEdit,
  };
}

export async function saveCompanyProfile(input: {
  supabase: SupabaseClient;
  organisationId: string;
  userId: string;
  displayName: string;
  websiteUrl: string;
  contacts: CompanyProfileContact[];
  points: unknown;
  note?: string | null;
}): Promise<{ ok: true; profile: CompanyProfile; editId: string | null } | { ok: false; message: string }> {
  const current = await loadCompanyProfile(input.supabase, input.organisationId, true);
  if (!current) return { ok: false, message: "Organisation nicht gefunden." };

  const nextDisplayName = clip(input.displayName, 160) || current.organisationName;
  const nextWebsiteUrl = clip(input.websiteUrl, 500);
  const nextContacts = normalizeProfileContacts(input.contacts);
  const nextPoints = normalizeIncomingPoints(input.points, current.points);

  const changes = buildCompanyProfileChanges({
    before: {
      displayName: current.displayName,
      websiteUrl: current.websiteUrl,
      contacts: current.contacts,
      points: current.points,
    },
    after: {
      displayName: nextDisplayName,
      websiteUrl: nextWebsiteUrl,
      contacts: nextContacts,
      points: nextPoints,
    },
  });

  if (changes.length === 0) {
    return { ok: true, profile: current, editId: null };
  }

  const workshop = await loadWorkshopState(input.supabase, input.organisationId);
  const hasContent = nextPoints.some((item) => item.current.trim());
  const nextAnbieter: AnbieterState = {
    ...workshop.anbieter,
    items: nextPoints,
    savedAt: new Date().toISOString(),
    revisionNote: workshop.anbieter.revisionNote,
    status: hasContent ? "approved" : "empty",
    sourceFingerprint: workshop.anbieter.sourceFingerprint ?? workshop.fingerprint,
    approvedFingerprint: hasContent
      ? (workshop.anbieter.approvedFingerprint ?? workshop.fingerprint)
      : null,
  };

  await saveAnbieterState(input.supabase, input.organisationId, nextAnbieter);

  if (hasContent) {
    await syncAnbieterToSeoAdvisor({
      supabase: input.supabase,
      organisationId: input.organisationId,
      organisationName: nextDisplayName || current.organisationName,
      anbieter: nextAnbieter,
    });
  }

  const { data: existingConfig, error: configLoadError } = await input.supabase
    .from("dt_org_config")
    .select("organisation_id")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();
  if (configLoadError) {
    return { ok: false, message: configLoadError.message || "Stammdaten konnten nicht geladen werden." };
  }
  if (existingConfig) {
    const { error: configError } = await input.supabase
      .from("dt_org_config")
      .update({
        display_name: nextDisplayName,
        website_url: nextWebsiteUrl || null,
      })
      .eq("organisation_id", input.organisationId);
    if (configError) {
      return { ok: false, message: configError.message || "Stammdaten konnten nicht gespeichert werden." };
    }
  }

  const contactsPayload = nextContacts.filter((c) => c.name || c.role || c.email || c.phone);
  const { data: existingOnboarding } = await input.supabase
    .from("dt_org_onboarding")
    .select("organisation_id")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  if (existingOnboarding) {
    const { error: contactError } = await input.supabase
      .from("dt_org_onboarding")
      .update({
        customer_contacts: contactsPayload,
        updated_by_user_id: input.userId,
      })
      .eq("organisation_id", input.organisationId);
    if (contactError) {
      return { ok: false, message: contactError.message || "Ansprechpartner konnten nicht gespeichert werden." };
    }
  } else if (contactsPayload.length > 0) {
    // Onboarding row is normally created with upload token; skip create here if missing.
    // Contacts stay empty until onboarding exists — still log other field changes.
  }

  const { data: editRow, error: editError } = await input.supabase
    .from("dt_company_profile_edits")
    .insert({
      organisation_id: input.organisationId,
      edited_by_user_id: input.userId,
      changes,
      note: input.note?.trim() ? input.note.trim().slice(0, 2_000) : null,
    })
    .select("id")
    .maybeSingle();

  if (editError) {
    return { ok: false, message: editError.message || "Änderung konnte nicht protokolliert werden." };
  }

  const profile = await loadCompanyProfile(input.supabase, input.organisationId, true);
  if (!profile) return { ok: false, message: "Profil nach dem Speichern nicht gefunden." };
  return { ok: true, profile, editId: editRow?.id ?? null };
}

function parseChanges(raw: unknown): CompanyProfileChange[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanyProfileChange[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : "";
    const label = typeof record.label === "string" ? record.label : key;
    if (!key) continue;
    out.push({
      key,
      label,
      before: typeof record.before === "string" ? record.before : "",
      after: typeof record.after === "string" ? record.after : "",
    });
  }
  return out;
}

export async function listCompanyProfileEditsForOrg(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<CompanyProfileEditRow[]> {
  const { data } = await supabase
    .from("dt_company_profile_edits")
    .select(EDIT_SELECT)
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .limit(40);

  return (data ?? []).map((row) => ({
    ...(row as Omit<CompanyProfileEditRow, "changes">),
    changes: parseChanges((row as { changes: unknown }).changes),
  }));
}

export async function listUnreviewedCompanyProfileEdits(
  supabase: SupabaseClient,
): Promise<CompanyProfileEditView[]> {
  const { data } = await supabase
    .from("dt_company_profile_edits")
    .select(`${EDIT_SELECT}, organisations(name)`)
    .is("reviewed_at", null)
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((row) => {
    const org = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
    const { organisations: _o, ...base } = row as typeof row & { organisations?: { name?: string } | { name?: string }[] };
    return {
      ...(base as Omit<CompanyProfileEditRow, "changes">),
      changes: parseChanges((base as { changes: unknown }).changes),
      organisation_name: org?.name,
    };
  });
}

export async function countUnreviewedCompanyProfileEdits(
  supabase: SupabaseClient,
): Promise<number> {
  const { count } = await supabase
    .from("dt_company_profile_edits")
    .select("id", { count: "exact", head: true })
    .is("reviewed_at", null);
  return count ?? 0;
}

export async function markCompanyProfileEditReviewed(input: {
  supabase: SupabaseClient;
  editId: string;
  reviewerUserId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await input.supabase
    .from("dt_company_profile_edits")
    .update({
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: input.reviewerUserId,
    })
    .eq("id", input.editId)
    .is("reviewed_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Eintrag nicht gefunden oder bereits gesehen." };
  return { ok: true };
}
