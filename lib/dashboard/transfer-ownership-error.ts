export function mapTransferOwnershipError(error: { message?: string }): string {
  const raw = (error.message ?? "").toLowerCase();
  if (raw.includes("forbidden") || raw.includes("not_authenticated")) {
    return "Keine Berechtigung: nur Inhaber oder Plattform-Admin können Ownership übertragen.";
  }
  return "Ownership konnte nicht übertragen werden.";
}
