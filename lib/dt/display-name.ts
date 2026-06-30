/** Turn email local parts (e.g. valeriy.solovyev) into readable names. */
export function formatPersonDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Nutzer";

  const local = trimmed.includes("@") ? trimmed.split("@")[0]! : trimmed;

  if (/^[a-z0-9._-]+$/i.test(local) && /[._-]/.test(local)) {
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  if (/^[a-z0-9._-]+$/i.test(local)) {
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }

  return trimmed;
}
