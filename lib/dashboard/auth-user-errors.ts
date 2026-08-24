export function isAlreadyRegisteredAuthError(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("user already exists") ||
    m.includes("email_exists")
  );
}

export function isForeignKeyRestrictError(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("foreign key") ||
    m.includes("violates foreign key") ||
    m.includes("restrict") ||
    m.includes("still referenced")
  );
}
