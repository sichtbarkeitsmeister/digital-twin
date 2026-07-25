/**
 * Display helpers for persona/avatar agents in chat UI.
 * Emoji/DISG are intentional product requirements (legacy portal parity).
 */

export type DtAgentDisplayInput = {
  name: string;
  role?: string | null;
  kind?: string | null;
  avatar_data?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Normalize DISG / DISC letter or label from avatar_data. */
export function extractAgentDisg(avatarData: unknown): string | null {
  const data = asRecord(avatarData);
  if (!data) return null;

  const raw =
    str(data.disg) ??
    str(data.DISG) ??
    str(data.disc) ??
    str(data.DISC) ??
    str(data.disg_typ) ??
    str(data.disg_type);
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const letter = upper.match(/\b([DISG])\b/)?.[1] ?? upper.match(/^([DISG])\b/)?.[1];
  if (letter) {
    const labels: Record<string, string> = {
      D: "Dominant (D)",
      I: "Initiativ (I)",
      S: "Stetig (S)",
      G: "Gewissenhaft (G)",
    };
    return labels[letter] ?? letter;
  }

  return raw.length > 40 ? `${raw.slice(0, 39)}…` : raw;
}

function disgLetter(avatarData: unknown): "D" | "I" | "S" | "G" | null {
  const label = extractAgentDisg(avatarData);
  if (!label) return null;
  const m = label.toUpperCase().match(/\b([DISG])\b/);
  return (m?.[1] as "D" | "I" | "S" | "G" | undefined) ?? null;
}

function emojiFromRole(role: string | null | undefined): string | null {
  if (!role) return null;
  const r = role.toLowerCase();
  if (/zahn|dental|praxis/.test(r)) return "🦷";
  if (/anwalt|recht|jura|kanzlei/.test(r)) return "⚖️";
  if (/arzt|medizin|klinik|gesundheit/.test(r)) return "🩺";
  if (/immobil|makler|haus|wohnung/.test(r)) return "🏠";
  if (/entrümpel|umzug|räum/.test(r)) return "📦";
  if (/handwerk|sanitär|elektro|bau/.test(r)) return "🔧";
  if (/gastro|restaurant|café|cafe|hotel/.test(r)) return "🍽️";
  if (/marketing|vertrieb|verkauf/.test(r)) return "📈";
  if (/it|software|tech|digital/.test(r)) return "💻";
  return null;
}

const DISG_EMOJI: Record<"D" | "I" | "S" | "G", string> = {
  D: "🎯",
  I: "☀️",
  S: "🤝",
  G: "📋",
};

export function emojiForAgent(input: DtAgentDisplayInput): string {
  const data = asRecord(input.avatar_data);
  const fromData = str(data?.emoji) ?? str(data?.avatar_emoji);
  if (fromData) return fromData;

  if (input.kind === "seo_advisor") return "📊";
  if (input.kind === "geo_advisor") return "🧭";

  const letter = disgLetter(input.avatar_data);
  if (letter) return DISG_EMOJI[letter];

  const fromRole = emojiFromRole(input.role);
  if (fromRole) return fromRole;

  return "👤";
}

export function formatAgentPrimaryLabel(input: DtAgentDisplayInput): string {
  const emoji = emojiForAgent(input);
  return `${emoji} ${input.name}`.trim();
}

export function formatAgentRoleSubtitle(input: DtAgentDisplayInput): string | null {
  return str(input.role);
}

export function formatAgentSwitcherLabel(input: DtAgentDisplayInput): string {
  const emoji = emojiForAgent(input);
  const role = str(input.role);
  if (role) return `${emoji} ${input.name} · ${role}`;
  return `${emoji} ${input.name}`;
}
