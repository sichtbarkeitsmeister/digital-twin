export type DtReplyVia =
  | "n8n"
  | "anthropic_direct"
  | "anthropic_direct_attachments"
  | "anthropic_ghost"
  | string;

export function formatDtReplyVia(via: string | null | undefined): string | null {
  if (!via?.trim()) return null;
  switch (via) {
    case "n8n":
      return "n8n";
    case "anthropic_direct":
      return "Anthropic (direkt)";
    case "anthropic_direct_attachments":
      return "Anthropic (Anhänge)";
    case "anthropic_ghost":
      return "Ghost (direkt)";
    default:
      return via;
  }
}
