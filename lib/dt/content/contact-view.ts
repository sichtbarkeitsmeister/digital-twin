/**
 * What the Kontaktdaten card in Texte gets from `/api/dt/content/contact`: the shared data,
 * whether a crawl exists (only then „Aus Website neu füllen“) and whether the Google search
 * can run. Service client: the route checked access.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { contactFieldText, type OrgContactData } from "@/lib/dt/contact-data";
import { loadOrgContactData } from "@/lib/dt/contact-data-store";
import { googleSearchInput } from "@/lib/dt/contact-google-search";
import type { ContentContactResult } from "@/lib/dt/content/types";

export function googleSearchBlocker(data: OrgContactData): string | null {
  if (data.no_google_profile) return "„Kein Google-Profil“ ist gewählt.";
  if (contactFieldText(data, "google_profil")) return "Das Google-Profil ist eingetragen.";
  const input = googleSearchInput(data);
  return input.ok ? null : input.reason;
}

export async function loadContentContactResult(service: SupabaseClient, organisationId: string): Promise<ContentContactResult> {
  const [loaded, { count, error }] = await Promise.all([
    loadOrgContactData(service, organisationId),
    service.from("dt_site_pages").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("is_excluded", false),
  ]);
  if (error) console.warn("[content/contact] crawl count:", error.message);
  return {
    contact: loaded.data,
    crawl_available: (count ?? 0) > 0,
    google_blocked: googleSearchBlocker(loaded.data),
  };
}
