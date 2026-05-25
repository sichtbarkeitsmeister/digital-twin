import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/**
 * Normalize a Leadinfo raw event into companies / visits / contacts.
 *
 * Leadinfo's payload varies; we extract a known core set of fields and stash
 * everything else in metadata so the schema stays stable while we learn the
 * real shape. Re-running this on the same raw event is idempotent.
 *
 * Payload: { rawEventId: uuid }
 */
export const leadinfoNormalizeHandler: JobHandler = async ({ job }) => {
  const rawEventId = (job.payload as { rawEventId?: string })?.rawEventId;
  if (!rawEventId) {
    return { ok: false, error: "Missing payload.rawEventId", retryable: false };
  }

  const supabase = createServiceClient();

  const { data: rawEvent, error: fetchError } = await supabase
    .from("integration_raw_events")
    .select("*")
    .eq("id", rawEventId)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: `Fetch raw event failed: ${fetchError.message}` };
  }
  if (!rawEvent) {
    return { ok: false, error: "Raw event not found", retryable: false };
  }

  if (rawEvent.match_status !== "matched" || !rawEvent.organisation_id) {
    await supabase
      .from("integration_raw_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", rawEvent.id);
    return {
      ok: true,
      result: { skipped: "unmatched_or_no_organisation" },
    };
  }

  const body = (rawEvent.body_json ?? {}) as Record<string, unknown>;
  const mapped = mapLeadinfoBody(body);

  if (!mapped.domain) {
    await supabase
      .from("integration_raw_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", rawEvent.id);
    return {
      ok: true,
      result: { skipped: "no_domain_in_payload" },
    };
  }

  const visitedAt = mapped.visitedAt ?? rawEvent.received_at;

  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("id, first_seen_at, visit_count, metadata")
    .eq("organisation_id", rawEvent.organisation_id)
    .eq("domain", mapped.domain)
    .maybeSingle();

  if (existingError) {
    return {
      ok: false,
      error: `Company lookup failed: ${existingError.message}`,
    };
  }

  let companyId: string;

  if (existing) {
    companyId = existing.id;
    const mergedMetadata = {
      ...((existing.metadata as Record<string, unknown> | null) ?? {}),
      ...mapped.companyMetadata,
    };
    const { error: updateError } = await supabase
      .from("companies")
      .update({
        last_seen_at: visitedAt,
        visit_count: (existing.visit_count ?? 0) + 1,
        name: mapped.name ?? undefined,
        industry: mapped.industry ?? undefined,
        size_range: mapped.sizeRange ?? undefined,
        country: mapped.country ?? undefined,
        region: mapped.region ?? undefined,
        city: mapped.city ?? undefined,
        metadata: mergedMetadata,
      })
      .eq("id", companyId);
    if (updateError) {
      return { ok: false, error: `Company update failed: ${updateError.message}` };
    }
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("companies")
      .insert({
        organisation_id: rawEvent.organisation_id,
        domain: mapped.domain,
        name: mapped.name,
        industry: mapped.industry,
        size_range: mapped.sizeRange,
        country: mapped.country,
        region: mapped.region,
        city: mapped.city,
        first_seen_at: visitedAt,
        last_seen_at: visitedAt,
        visit_count: 1,
        source: "leadinfo",
        metadata: mapped.companyMetadata,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return {
        ok: false,
        error: `Company insert failed: ${insertError?.message ?? "no row returned"}`,
      };
    }
    companyId = inserted.id;
  }

  // Idempotency: skip if a visit already references this raw event.
  const { data: existingVisit } = await supabase
    .from("visits")
    .select("id")
    .eq("raw_event_id", rawEvent.id)
    .maybeSingle();

  if (!existingVisit) {
    const { error: visitError } = await supabase.from("visits").insert({
      organisation_id: rawEvent.organisation_id,
      company_id: companyId,
      raw_event_id: rawEvent.id,
      visited_at: visitedAt,
      pages: mapped.pages,
      duration_s: mapped.durationS,
      referrer: mapped.referrer,
      source: "leadinfo",
      metadata: mapped.visitMetadata,
    });
    if (visitError) {
      return { ok: false, error: `Visit insert failed: ${visitError.message}` };
    }
  }

  for (const c of mapped.contacts) {
    const lookup = supabase
      .from("contacts")
      .select("id")
      .eq("organisation_id", rawEvent.organisation_id)
      .eq("company_id", companyId);

    const { data: existingContact } = c.email
      ? await lookup.eq("email", c.email).maybeSingle()
      : await lookup
          .ilike("full_name", c.fullName ?? "___never___")
          .maybeSingle();

    if (existingContact) continue;

    await supabase.from("contacts").insert({
      organisation_id: rawEvent.organisation_id,
      company_id: companyId,
      source: "leadinfo",
      full_name: c.fullName,
      first_name: c.firstName,
      last_name: c.lastName,
      title: c.title,
      email: c.email,
      linkedin_url: c.linkedinUrl,
      phone: c.phone,
      metadata: c.metadata,
    });
  }

  await supabase
    .from("integration_raw_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", rawEvent.id);

  return {
    ok: true,
    result: {
      companyId,
      domain: mapped.domain,
      contactsInserted: mapped.contacts.length,
    },
  };
};

type MappedContact = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  metadata: Record<string, unknown>;
};

type MappedPayload = {
  domain: string | null;
  name: string | null;
  industry: string | null;
  sizeRange: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  visitedAt: string | null;
  pages: unknown[];
  durationS: number | null;
  referrer: string | null;
  contacts: MappedContact[];
  companyMetadata: Record<string, unknown>;
  visitMetadata: Record<string, unknown>;
};

const KNOWN_DOMAIN_KEYS = ["domain", "website", "company_domain", "host"];
const KNOWN_NAME_KEYS = ["company", "company_name", "name"];
const KNOWN_INDUSTRY_KEYS = ["industry", "branch", "branche"];
const KNOWN_SIZE_KEYS = ["company_size", "size", "employees", "employee_count"];
const KNOWN_COUNTRY_KEYS = ["country", "country_code"];
const KNOWN_REGION_KEYS = ["region", "state"];
const KNOWN_CITY_KEYS = ["city", "town"];
const KNOWN_VISITED_AT_KEYS = ["visited_at", "timestamp", "date", "time"];
const KNOWN_DURATION_KEYS = ["duration", "duration_s", "duration_seconds"];
const KNOWN_REFERRER_KEYS = ["referrer", "referer", "source"];
const KNOWN_PAGES_KEYS = ["pages", "page_views", "visited_pages"];
const KNOWN_COMPANY_OBJECT_KEYS = ["company", "organization", "organisation"];
const KNOWN_VISITOR_KEYS = ["visitor", "user", "person", "contact"];
const KNOWN_CONTACTS_ARRAY_KEYS = ["contacts", "people", "leads"];

function pickString(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function pickNumber(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function pickFirstObject(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const v = source[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return null;
}

function normaliseDomain(value: string | null): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/^www\./, "");
  v = v.split("/")[0] ?? v;
  v = v.split("?")[0] ?? v;
  return v || null;
}

function toIsoDate(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const d = typeof raw === "number" ? new Date(raw) : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function mapLeadinfoBody(body: Record<string, unknown>): MappedPayload {
  const companyObj = pickFirstObject(body, KNOWN_COMPANY_OBJECT_KEYS) ?? body;
  const visitorObj = pickFirstObject(body, KNOWN_VISITOR_KEYS);

  const domain = normaliseDomain(
    pickString(body, KNOWN_DOMAIN_KEYS) ??
      pickString(companyObj, KNOWN_DOMAIN_KEYS),
  );

  const name =
    pickString(body, KNOWN_NAME_KEYS) ??
    pickString(companyObj, ["name", "company_name"]);

  const industry =
    pickString(body, KNOWN_INDUSTRY_KEYS) ??
    pickString(companyObj, KNOWN_INDUSTRY_KEYS);

  const sizeRange =
    pickString(body, KNOWN_SIZE_KEYS) ??
    pickString(companyObj, KNOWN_SIZE_KEYS);

  const country =
    pickString(body, KNOWN_COUNTRY_KEYS) ??
    pickString(companyObj, KNOWN_COUNTRY_KEYS);

  const region =
    pickString(body, KNOWN_REGION_KEYS) ??
    pickString(companyObj, KNOWN_REGION_KEYS);

  const city =
    pickString(body, KNOWN_CITY_KEYS) ??
    pickString(companyObj, KNOWN_CITY_KEYS);

  const visitedAt = toIsoDate(pickString(body, KNOWN_VISITED_AT_KEYS));
  const durationS = pickNumber(body, KNOWN_DURATION_KEYS);
  const referrer = pickString(body, KNOWN_REFERRER_KEYS);

  const rawPages = body["pages"] ?? body["page_views"] ?? body["visited_pages"];
  const pages = Array.isArray(rawPages) ? rawPages : [];

  const contacts: MappedContact[] = [];

  if (visitorObj) {
    contacts.push(toContact(visitorObj));
  }

  for (const key of KNOWN_CONTACTS_ARRAY_KEYS) {
    const arr = body[key];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (entry && typeof entry === "object") {
          contacts.push(toContact(entry as Record<string, unknown>));
        }
      }
    }
  }

  return {
    domain,
    name,
    industry,
    sizeRange,
    country,
    region,
    city,
    visitedAt,
    pages,
    durationS,
    referrer,
    contacts,
    companyMetadata: { _raw_company: companyObj === body ? null : companyObj },
    visitMetadata: pages.length === 0 ? {} : { _page_count: pages.length },
  };
}

function toContact(source: Record<string, unknown>): MappedContact {
  const explicit = pickString(source, ["full_name", "name"]);
  const composed = [
    pickString(source, ["first_name"]),
    pickString(source, ["last_name"]),
  ]
    .filter(Boolean)
    .join(" ");
  const fullName = explicit ?? (composed ? composed : null);

  return {
    fullName,
    firstName: pickString(source, ["first_name"]),
    lastName: pickString(source, ["last_name"]),
    title: pickString(source, ["title", "job_title", "position"]),
    email: pickString(source, ["email"])?.toLowerCase() ?? null,
    linkedinUrl: pickString(source, ["linkedin_url", "linkedin"]),
    phone: pickString(source, ["phone", "phone_number"]),
    metadata: { _raw: source },
  };
}
