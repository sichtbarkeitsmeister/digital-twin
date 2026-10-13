/**
 * The three Textwerkzeuge under Verwaltung (GEO, SEO, Wasserzeichen): ids, labels, routes
 * and the feature flag that shows or hides them. Pure, safe for client components; the
 * flag is read on the server (layout, pages, routes) and handed down as a prop.
 */

export const TEXT_TOOL_IDS = ["geo", "seo", "watermark"] as const;
export type TextToolId = (typeof TEXT_TOOL_IDS)[number];

export type TextToolDefinition = {
  id: TextToolId;
  /** Route segment under `/dashboard/verwaltung/textwerkzeuge/`. */
  slug: string;
  /** Sidebar and page title. */
  label: string;
  /** One sentence for the overview page and the placeholder. */
  description: string;
};

export const TEXT_TOOLS_BASE_PATH = "/dashboard/verwaltung/textwerkzeuge";

export const TEXT_TOOLS: Record<TextToolId, TextToolDefinition> = {
  geo: {
    id: "geo",
    slug: "geo",
    label: "GEO-Text",
    description:
      "Einen Text für KI-Suchen (Generative Engine Optimization) prüfen und so umschreiben, dass Antwortmaschinen ihn zitieren.",
  },
  seo: {
    id: "seo",
    slug: "seo",
    label: "SEO-Text",
    description:
      "Einen Text auf ein Keyword hin prüfen und überarbeiten: Titel, Meta-Description, Überschriften, Lesbarkeit.",
  },
  watermark: {
    id: "watermark",
    slug: "wasserzeichen",
    label: "Wasserzeichen",
    description:
      "Unsichtbare Zeichen, KI-typische Muster und verräterische Formulierungen aus einem Text entfernen.",
  },
};

export const TEXT_TOOL_LIST: readonly TextToolDefinition[] = TEXT_TOOL_IDS.map((id) => TEXT_TOOLS[id]);

export function isTextToolId(value: unknown): value is TextToolId {
  return typeof value === "string" && (TEXT_TOOL_IDS as readonly string[]).includes(value);
}

export function textToolFromSlug(slug: string): TextToolDefinition | null {
  const wanted = slug.trim().toLowerCase();
  return TEXT_TOOL_LIST.find((tool) => tool.slug === wanted || tool.id === wanted) ?? null;
}

export function textToolHref(id: TextToolId, organisationId?: string | null): string {
  const base = `${TEXT_TOOLS_BASE_PATH}/${TEXT_TOOLS[id].slug}`;
  return organisationId ? `${base}?org=${encodeURIComponent(organisationId)}` : base;
}

export function isTextToolsPath(pathname: string): boolean {
  return pathname === TEXT_TOOLS_BASE_PATH || pathname.startsWith(`${TEXT_TOOLS_BASE_PATH}/`);
}

// --- feature flag -----------------------------------------------------------------------------

export const TEXT_TOOLS_FLAG_ENV = "DT_TEXT_TOOLS";

/**
 * `DT_TEXT_TOOLS` decides which tools are visible: `all`, `none`, or a comma list of ids or
 * route slugs (`geo,seo,wasserzeichen`). Unset means every tool outside production and none in
 * production, so a deploy never shows a tool before the agency switches it on. Order follows
 * `TEXT_TOOL_IDS`, unknown names are ignored.
 */
export function parseTextToolFlags(raw: string | null | undefined, nodeEnv: string | undefined): TextToolId[] {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!value) return nodeEnv === "production" ? [] : [...TEXT_TOOL_IDS];
  if (value === "all" || value === "*" || value === "1" || value === "true") return [...TEXT_TOOL_IDS];
  if (value === "none" || value === "0" || value === "false") return [];
  const wanted = new Set<TextToolId>();
  for (const part of value.split(/[,\s;]+/)) {
    const tool = part ? textToolFromSlug(part) : null;
    if (tool) wanted.add(tool.id);
  }
  return TEXT_TOOL_IDS.filter((id) => wanted.has(id));
}

/** Server only: the enabled tools from the environment. */
export function enabledTextTools(): TextToolId[] {
  return parseTextToolFlags(process.env[TEXT_TOOLS_FLAG_ENV], process.env.NODE_ENV);
}

export function isTextToolEnabled(id: TextToolId): boolean {
  return enabledTextTools().includes(id);
}
