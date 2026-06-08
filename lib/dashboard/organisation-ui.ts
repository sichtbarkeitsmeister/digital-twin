export function formatOrgRole(role: string) {
  if (role === "owner") return "Inhaber";
  if (role === "admin") return "Admin";
  if (role === "employee") return "Mitarbeiter";
  return role;
}

export function formatOrgDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function memberInitials(email: string | null | undefined) {
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return local.slice(0, 2).toUpperCase() || "?";
}

export function memberDisplayName(email: string | null | undefined) {
  return email?.trim() || "E-Mail nicht verfügbar";
}
