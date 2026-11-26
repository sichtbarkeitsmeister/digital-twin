export function mapTransferOwnershipError(error: { message?: string }): string {
  const raw = (error.message ?? "").toLowerCase();
  if (raw.includes("forbidden") || raw.includes("not_authenticated")) {
    return "Keine Berechtigung: nur der Inhaber oder ein Plattform-Admin kann den Inhaber ändern.";
  }
  if (raw.includes("org_not_found")) {
    return "Organisation wurde nicht gefunden.";
  }
  if (raw.includes("invalid_user")) {
    return "Das Konto des neuen Inhabers ist ungültig.";
  }
  return "Der Inhaber konnte nicht geändert werden.";
}
