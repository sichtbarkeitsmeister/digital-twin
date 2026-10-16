/**
 * Browser tab title on logged-in pages: „{Organisation} · DigitalTwin“, or „DigitalTwin“ while
 * no organisation is known. Pure, so the order of the sources is testable; the client component
 * `components/shared/organisation-document-title.tsx` feeds it and sets `document.title`.
 *
 * Which organisation, first match wins, and only ids from the user's own list count:
 *   1. the `[organisationId]` path param on /dashboard/organisations/[id]
 *   2. `?org=` in the URL
 *   3. the stored selection (`app:selected-organisation-id`)
 *   4. the user's first organisation
 */

import { organisationOptionLabel, type OrganisationOption } from "@/lib/shared/organisation-option";

export const APP_DOCUMENT_TITLE = "DigitalTwin";

const ORGANISATION_PATH_RE = /^\/dashboard\/organisations\/([^/?#]+)/;

/** The id in /dashboard/organisations/[organisationId] (and its sub-pages), else null. */
export function organisationIdFromPath(pathname: string | null | undefined): string | null {
  const match = (pathname ?? "").match(ORGANISATION_PATH_RE);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

/** „{Organisation} · DigitalTwin“; „DigitalTwin“ without an organisation or a label. */
export function organisationDocumentTitle(organisation: OrganisationOption | null | undefined): string {
  if (!organisation) return APP_DOCUMENT_TITLE;
  const label = organisationOptionLabel(organisation).trim();
  return label ? `${label} · ${APP_DOCUMENT_TITLE}` : APP_DOCUMENT_TITLE;
}

export type OrganisationTitleSources = {
  /** The user's organisations, in the order of `/api/dt/organisations/mine`. */
  organisations: readonly OrganisationOption[];
  pathname?: string | null;
  urlOrganisationId?: string | null;
  storedOrganisationId?: string | null;
};

/** The candidate ids in their order of precedence (before checking access). */
export function organisationTitleCandidates(input: Omit<OrganisationTitleSources, "organisations">): string[] {
  return [
    organisationIdFromPath(input.pathname),
    input.urlOrganisationId?.trim() || null,
    input.storedOrganisationId?.trim() || null,
  ].filter((id): id is string => Boolean(id));
}

export function resolveTitleOrganisation(input: OrganisationTitleSources): OrganisationOption | null {
  const byId = new Map(input.organisations.map((organisation) => [organisation.id, organisation]));
  for (const id of organisationTitleCandidates(input)) {
    const found = byId.get(id);
    if (found) return found;
  }
  return input.organisations[0] ?? null;
}

export function resolveOrganisationDocumentTitle(input: OrganisationTitleSources): string {
  return organisationDocumentTitle(resolveTitleOrganisation(input));
}
