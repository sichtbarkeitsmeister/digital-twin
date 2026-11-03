/**
 * Kontaktdaten in the database: `dt_org_contact_data` (one row per organisation, migration
 * 20261103) plus the three Firmenprofil columns behind Firmenname, Website and Ansprechpartner.
 * Used by the Firmenprofil (user client, RLS) and by Texte and its jobs (service client).
 *
 * Every save goes into the Firmenprofil's change log `dt_company_profile_edits` when a person
 * is known, so staff see the diffs as for any Firmenprofil change. A missing table is an
 * error with the migration's name, never an empty card.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONTACT_DATA_MIGRATION_FILE,
  applyAutomaticContactValues,
  applyManualContactValues,
  contactDataRowPatch,
  contactPromptData,
  diffContactData,
  isReusedContactField,
  readOrgContactData,
  withProfileColumns,
  type ContactDataChange,
  type ContactDataInput,
  type ContactFieldKey,
  type ContactProfileColumns,
  type ContactPromptData,
  type ContactSource,
  type OrgContactData,
} from "@/lib/dt/contact-data";

const CONTACT_COLUMNS = "organisation_id, fields, custom_fields, no_google_profile, google_search, crawl_fill, updated_at";

/** The table or a column is missing: the migration has not run. */
export class ContactDataMigrationError extends Error {
  constructor() {
    super(
      `Die Datenbank kennt die Kontaktdaten noch nicht: Bitte ${CONTACT_DATA_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`,
    );
    this.name = "ContactDataMigrationError";
  }
}

export function isMissingContactDataError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (/dt_org_contact_data|client_wishes/i.test(message) && /does not exist|schema cache|could not find/i.test(message))
  );
}

export type LoadedContactData = {
  /** With Firmenname, Website and Ansprechpartner read from the Firmenprofil. */
  data: OrgContactData;
  /** As stored in `dt_org_contact_data` (the reused fields only as their source). */
  stored: OrgContactData;
  columns: ContactProfileColumns;
  hasConfigRow: boolean;
  hasOnboardingRow: boolean;
  /** The Firmenprofil's Ansprechpartner as stored (for the mirror write). */
  contacts: Array<{ name: string; role: string; email: string; phone: string }>;
};

function firstContactOf(raw: unknown): { name: string; role: string } | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const role = typeof r.role === "string" ? r.role.trim() : "";
    if (name || role) return { name, role };
  }
  return null;
}

function contactList(raw: unknown): LoadedContactData["contacts"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((r) => ({
      name: typeof r.name === "string" ? r.name : "",
      role: typeof r.role === "string" ? r.role : "",
      email: typeof r.email === "string" ? r.email : "",
      phone: typeof r.phone === "string" ? r.phone : "",
    }));
}

export async function loadOrgContactData(supabase: SupabaseClient, organisationId: string): Promise<LoadedContactData> {
  const [contact, config, onboarding] = await Promise.all([
    supabase.from("dt_org_contact_data").select(CONTACT_COLUMNS).eq("organisation_id", organisationId).maybeSingle(),
    supabase.from("dt_org_config").select("display_name, website_url").eq("organisation_id", organisationId).maybeSingle(),
    supabase.from("dt_org_onboarding").select("customer_contacts").eq("organisation_id", organisationId).maybeSingle(),
  ]);
  if (contact.error) {
    if (isMissingContactDataError(contact.error)) throw new ContactDataMigrationError();
    throw new Error(`Kontaktdaten konnten nicht geladen werden: ${contact.error.message}`);
  }
  const stored = readOrgContactData(contact.data as Record<string, unknown> | null);
  const configRow = config.data as { display_name?: string | null; website_url?: string | null } | null;
  const contactsRaw = (onboarding.data as { customer_contacts?: unknown } | null)?.customer_contacts;
  const columns: ContactProfileColumns = {
    displayName: configRow?.display_name ?? null,
    websiteUrl: configRow?.website_url ?? null,
    firstContact: firstContactOf(contactsRaw),
  };
  return {
    data: withProfileColumns(stored, columns),
    stored,
    columns,
    hasConfigRow: Boolean(configRow),
    hasOnboardingRow: Boolean(onboarding.data),
    contacts: contactList(contactsRaw),
  };
}

/** What the pipeline gets: only the filled fields (null when there are none). Read fresh for every step. */
export async function loadContactPromptData(service: SupabaseClient, organisationId: string): Promise<ContactPromptData | null> {
  const loaded = await loadOrgContactData(service, organisationId);
  return contactPromptData(loaded.data, { ansprechpartnerRole: loaded.columns.firstContact?.role ?? null });
}

/**
 * The stored row for the resolved data: the reused fields keep a copy of their value so a later
 * change in the Firmenprofil is recognised as manual (`resolveReusedField`).
 */
async function writeRow(
  supabase: SupabaseClient,
  organisationId: string,
  data: OrgContactData,
  userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("dt_org_contact_data")
    .upsert({ organisation_id: organisationId, ...contactDataRowPatch(data), updated_by: userId }, { onConflict: "organisation_id" });
  if (error) {
    if (isMissingContactDataError(error)) throw new ContactDataMigrationError();
    throw new Error(`Kontaktdaten konnten nicht gespeichert werden: ${error.message}`);
  }
}

/**
 * A person's change of Firmenname, Website or Ansprechpartner goes into the Firmenprofil's own
 * columns too, so both views show the same value. Display name: never emptied (NOT NULL).
 */
async function mirrorReusedFields(
  supabase: SupabaseClient,
  organisationId: string,
  loaded: LoadedContactData,
  next: OrgContactData,
  keys: readonly ContactFieldKey[],
): Promise<void> {
  const value = (key: ContactFieldKey) => next.fields[key]?.value.trim() ?? "";
  if (loaded.hasConfigRow && (keys.includes("firmenname") || keys.includes("website"))) {
    const patch: Record<string, unknown> = {};
    if (keys.includes("firmenname") && value("firmenname")) patch.display_name = value("firmenname");
    if (keys.includes("website")) patch.website_url = value("website") || null;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("dt_org_config").update(patch).eq("organisation_id", organisationId);
      if (error) throw new Error(`Firmenname/Website konnten nicht gespeichert werden: ${error.message}`);
    }
  }
  if (loaded.hasOnboardingRow && keys.includes("ansprechpartner")) {
    const contacts = loaded.contacts.filter((c) => c.name.trim() || c.role.trim() || c.email.trim() || c.phone.trim());
    const name = value("ansprechpartner");
    if (contacts.length > 0) contacts[0] = { ...contacts[0]!, name };
    else if (name) contacts.push({ name, role: "", email: "", phone: "" });
    const { error } = await supabase
      .from("dt_org_onboarding")
      .update({ customer_contacts: contacts.filter((c) => c.name.trim() || c.role.trim() || c.email.trim() || c.phone.trim()) })
      .eq("organisation_id", organisationId);
    if (error) throw new Error(`Ansprechpartner konnte nicht gespeichert werden: ${error.message}`);
  }
}

/** One entry in the Firmenprofil's change log; nothing without a person or without a change. */
export async function logContactChanges(
  supabase: SupabaseClient,
  input: { organisationId: string; userId: string | null; changes: readonly ContactDataChange[]; note: string | null },
): Promise<string | null> {
  if (!input.userId || input.changes.length === 0) return null;
  const { data, error } = await supabase
    .from("dt_company_profile_edits")
    .insert({
      organisation_id: input.organisationId,
      edited_by_user_id: input.userId,
      changes: input.changes,
      note: input.note?.trim() ? input.note.trim().slice(0, 2_000) : null,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Änderung konnte nicht protokolliert werden: ${error.message}`);
  return (data as { id?: string } | null)?.id ?? null;
}

export type SaveContactDataResult = { data: OrgContactData; changes: ContactDataChange[]; editId: string | null };

/**
 * A person saves the card (Texte or Firmenprofil), or a customer's answer lands in a field
 * (`source: "antwort"`). Changed fields become manual; Firmenname, Website and Ansprechpartner
 * are written to the Firmenprofil as well. `skipReused` leaves those three alone (the
 * Firmenprofil saves them itself) and `log: false` leaves the change log to the caller.
 */
export async function saveOrgContactData(
  supabase: SupabaseClient,
  input: {
    organisationId: string;
    userId: string | null;
    values: ContactDataInput;
    source?: Extract<ContactSource, "manuell" | "antwort">;
    note?: string | null;
    skipReused?: boolean;
    log?: boolean;
    now?: Date;
  },
): Promise<SaveContactDataResult> {
  const loaded = await loadOrgContactData(supabase, input.organisationId);
  const values: ContactDataInput = input.skipReused
    ? { ...input.values, fields: Object.fromEntries(Object.entries(input.values.fields ?? {}).filter(([key]) => !isReusedContactField(key))) }
    : input.values;
  const next = applyManualContactValues(loaded.data, values, input.now ?? new Date(), input.source ?? "manuell");
  const changes = diffContactData(loaded.data, next);
  const sourceChanged = JSON.stringify(loaded.data.fields) !== JSON.stringify(next.fields);
  if (changes.length === 0 && !sourceChanged) return { data: loaded.data, changes: [], editId: null };

  await writeRow(supabase, input.organisationId, next, input.userId);
  const changedReused = (["firmenname", "website", "ansprechpartner"] as const).filter(
    (key) => (loaded.data.fields[key]?.value ?? "") !== (next.fields[key]?.value ?? ""),
  );
  if (!input.skipReused && changedReused.length > 0) {
    await mirrorReusedFields(supabase, input.organisationId, loaded, next, changedReused);
  }
  const editId = input.log === false ? null : await logContactChanges(supabase, { organisationId: input.organisationId, userId: input.userId, changes, note: input.note ?? null });
  const reloaded = await loadOrgContactData(supabase, input.organisationId);
  return { data: reloaded.data, changes, editId };
}

/**
 * Values the crawl or the web search found: only empty or automatically filled fields change
 * (`applyAutomaticContactValues`); the reused fields only in this table, never in the
 * Firmenprofil's columns. `extra` stores the record of the fill or the search with it.
 */
export async function saveAutomaticContactValues(
  supabase: SupabaseClient,
  input: {
    organisationId: string;
    found: Partial<Record<ContactFieldKey, string | null | undefined>>;
    source: Extract<ContactSource, "crawl" | "websuche">;
    userId: string | null;
    note: string;
    /** The record of the fill or search, given the fields that changed. */
    extra?: (changed: ContactFieldKey[]) => Partial<Pick<OrgContactData, "crawl_fill" | "google_search">>;
    now?: Date;
  },
): Promise<SaveContactDataResult & { changed: ContactFieldKey[] }> {
  const loaded = await loadOrgContactData(supabase, input.organisationId);
  const { data, changed } = applyAutomaticContactValues(loaded.data, input.found, input.source, input.now ?? new Date());
  const next: OrgContactData = { ...data, ...(input.extra?.(changed) ?? {}) };
  const changes = diffContactData(loaded.data, next);
  await writeRow(supabase, input.organisationId, next, input.userId);
  const editId = await logContactChanges(supabase, { organisationId: input.organisationId, userId: input.userId, changes, note: input.note });
  const reloaded = await loadOrgContactData(supabase, input.organisationId);
  return { data: reloaded.data, changes, editId, changed };
}
