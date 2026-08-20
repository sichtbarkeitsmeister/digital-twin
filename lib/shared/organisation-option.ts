export type OrganisationOption = {
  id: string;
  name: string;
  slug?: string | null;
  displayName?: string | null;
};

export function organisationOptionLabel(org: OrganisationOption | null | undefined): string {
  if (!org) return "Organisation";
  return org.displayName?.trim() || org.name;
}

export function matchesSearchQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  if (hay.includes(q)) return true;
  const compactQuery = q.replace(/[^a-z0-9]/g, "");
  const compactHay = hay.replace(/[^a-z0-9]/g, "");
  return compactQuery.length >= 3 && compactHay.includes(compactQuery);
}

export function filterOrganisationOptions(
  organisations: OrganisationOption[],
  query: string,
): OrganisationOption[] {
  const q = query.trim();
  if (!q) return organisations;
  return organisations.filter((org) =>
    matchesSearchQuery(
      [org.name, org.displayName ?? "", org.slug ?? ""].join("\n"),
      q,
    ),
  );
}
