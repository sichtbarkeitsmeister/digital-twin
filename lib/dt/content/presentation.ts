import type {
  ContentActionKind,
  ContentPageState,
  ContentPageSummary,
} from "@/lib/dt/content/types";

export type ContentStateTone = "grey" | "blue" | "yellow" | "orange" | "green";

export const CONTENT_STATE_META: Record<ContentPageState, { label: string; tone: ContentStateTone }> =
  {
    nicht_begonnen: { label: "Nicht begonnen", tone: "grey" },
    laeuft: { label: "Läuft", tone: "blue" },
    in_arbeit: { label: "In Arbeit", tone: "yellow" },
    braucht_sie: { label: "Braucht Sie", tone: "orange" },
    fertig: { label: "Fertig", tone: "green" },
  };

export function contentStateMeta(state: string): { label: string; tone: ContentStateTone } {
  return CONTENT_STATE_META[state as ContentPageState] ?? CONTENT_STATE_META.nicht_begonnen;
}

/** Fixed German button labels; kinds not listed here are not rendered. */
export const CONTENT_ACTION_LABELS: Record<ContentActionKind, string> = {
  approve: "Freigeben",
  edit: "Abschnitt ändern",
  rerun_with_note: "Mit Anmerkung wiederholen",
  run_through: "Weiterlaufen lassen",
  export: "Exportieren",
  stop: "Stoppen",
  reset: "Zurücksetzen",
};

export function contentActionLabel(kind: string): string | null {
  return CONTENT_ACTION_LABELS[kind as ContentActionKind] ?? null;
}

export function contentStepStatusLabel(status: string): string {
  switch (status) {
    case "done":
      return "Erledigt";
    case "running":
      return "Läuft";
    case "waiting":
      return "Wartet auf Freigabe";
    case "error":
      return "Fehler";
    case "skipped":
      return "Übersprungen";
    case "pending":
      return "Offen";
    default:
      return status ? status.replace(/_/g, " ") : "Offen";
  }
}

export function anyContentPageRunning(pages: Pick<ContentPageSummary, "state">[]): boolean {
  return pages.some((p) => p.state === "laeuft");
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ContentBlock = { id: string; text: string };

/**
 * Editable blocks of a rendered text: elements carrying `data-block-id`.
 * Nested blocks are not expected; the first closing tag of the same name ends a block.
 */
export function extractContentBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const seen = new Set<string>();
  const re = /<([a-z][a-z0-9]*)\b[^>]*\bdata-block-id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const id = match[2]!.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    blocks.push({ id, text: htmlToPlainText(match[3] ?? "") });
  }
  return blocks;
}

export function formatContentDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}
