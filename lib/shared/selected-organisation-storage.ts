export const SELECTED_ORGANISATION_STORAGE_KEY = "app:selected-organisation-id";

export function readSelectedOrganisationId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SELECTED_ORGANISATION_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function writeSelectedOrganisationId(organisationId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!organisationId) {
      window.localStorage.removeItem(SELECTED_ORGANISATION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SELECTED_ORGANISATION_STORAGE_KEY, organisationId);
  } catch {
    // ignore
  }
}

export function pickOrganisationId(
  allowedOrganisationIds: string[],
  options?: {
    urlOrganisationId?: string | null;
    storedOrganisationId?: string | null;
    fallbackOrganisationId?: string | null;
  },
): string | null {
  const allowed = new Set(allowedOrganisationIds);
  const urlId = options?.urlOrganisationId?.trim();
  if (urlId && allowed.has(urlId)) return urlId;

  const storedId = options?.storedOrganisationId?.trim() ?? readSelectedOrganisationId();
  if (storedId && allowed.has(storedId)) return storedId;

  const fallbackId = options?.fallbackOrganisationId?.trim();
  if (fallbackId && allowed.has(fallbackId)) return fallbackId;

  return allowedOrganisationIds[0] ?? null;
}
