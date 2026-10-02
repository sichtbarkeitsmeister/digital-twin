/** Buyer-side value equation. Same names as the persona exam. Industry-neutral. */
export const AVATAR_VALUE_FIELDS = [
  { key: "schmerz", label: "Schmerz" },
  { key: "traumergebnis", label: "Traumergebnis" },
  { key: "dringlichkeit", label: "Dringlichkeit" },
  { key: "huerde", label: "Hürde" },
  { key: "aufwand", label: "Aufwand und Verzicht" },
  { key: "zeit", label: "Zeit" },
  { key: "wahrscheinlichkeit", label: "Wahrscheinlichkeit" },
] as const;

export type AvatarValueKey = (typeof AVATAR_VALUE_FIELDS)[number]["key"];
