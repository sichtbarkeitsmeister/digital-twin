import { slugifyOrganisationName } from "@/lib/dt/org-slug";

export const MAX_FOCUSED_WORKSPACE_ORGS = 3;
export const MAX_CRAWL_SUMMARY_CHARS = 14_000;
export const MAX_SITE_PAGE_INDEX = 80;

export type SurveyAssistantOrgDirectoryEntry = {
  id: string;
  name: string;
  slug: string | null;
  displayName: string | null;
  websiteUrl: string | null;
  crawlPageCount: number;
  lastCrawlStatus: string | null;
  lastCrawledAt: string | null;
  openTaskCount: number;
  inProgressTaskCount: number;
};

export type SurveyAssistantFocusedOrgWorkspace = {
  organisationId: string;
  organisationName: string;
  websiteUrl: string | null;
  crawlPageCount: number;
  crawlSummary: string;
  sitePageIndex: string;
  openTasks: string;
};

export type SurveyAssistantWorkspace = {
  organisations: SurveyAssistantOrgDirectoryEntry[];
  focused: SurveyAssistantFocusedOrgWorkspace[];
};

type WorkspaceTask = {
  id: string;
  title: string;
  keyword: string | null;
  status: "open" | "in_progress" | "done" | "wont_fix" | string;
  current_status?: string | null;
  action: string | null;
  url: string | null;
  priority: string | null;
};

type WorkspaceSitePage = {
  url: string;
  title?: string | null;
  h1?: string | null;
};

export function clipWorkspaceText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 20)).trimEnd()}\n\n…[gekürzt]`;
}

function organisationAliases(org: SurveyAssistantOrgDirectoryEntry): string[] {
  const raw = [
    org.name,
    org.slug,
    org.displayName,
    org.websiteUrl,
  ];
  if (org.websiteUrl) {
    try {
      const hostname = new URL(
        org.websiteUrl.includes("://") ? org.websiteUrl : `https://${org.websiteUrl}`,
      ).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      if (hostname) {
        raw.push(hostname);
        const sld = hostname.split(".")[0];
        if (sld) {
          raw.push(sld);
          raw.push(sld.replace(/-/g, " "));
        }
      }
    } catch {
      /* ignore invalid website */
    }
  }

  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of raw) {
    const trimmed = (value ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(trimmed);
    const slug = slugifyOrganisationName(trimmed);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      aliases.push(slug);
    }
  }
  return aliases;
}

function compactAlnum(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

export function matchOrganisationIdsInText(
  haystack: string,
  orgs: SurveyAssistantOrgDirectoryEntry[],
): string[] {
  const text = haystack.toLowerCase();
  const compactHay = compactAlnum(haystack);
  if (!text.trim()) return [];

  const matched: string[] = [];
  for (const org of orgs) {
    if (text.includes(org.id.toLowerCase())) {
      matched.push(org.id);
      continue;
    }
    const aliases = organisationAliases(org);
    const hit = aliases.some((alias) => {
      const a = alias.trim().toLowerCase();
      if (a.length >= 5 && text.includes(a)) return true;
      const compact = compactAlnum(alias);
      if (compact.length >= 6 && compactHay.includes(compact)) return true;
      const firstWord = a.split(/[\s/-]+/).find((w) => w.length >= 8);
      return Boolean(firstWord && text.includes(firstWord));
    });
    if (hit) matched.push(org.id);
  }
  return matched;
}

export function pickFocusedOrganisationIds(input: {
  organisations: SurveyAssistantOrgDirectoryEntry[];
  pageOrganisationId?: string | null;
  surveyOrganisationId?: string | null;
  userMessage?: string;
  surveyTitle?: string | null;
  conversationSummary?: string;
  limit?: number;
}): string[] {
  const limit = input.limit ?? MAX_FOCUSED_WORKSPACE_ORGS;
  const ordered: string[] = [];
  const seen = new Set<string>();
  const known = new Set(input.organisations.map((o) => o.id));

  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id) || !known.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };

  push(input.pageOrganisationId);
  push(input.surveyOrganisationId);

  const haystacks = [
    input.userMessage ?? "",
    input.surveyTitle ?? "",
    input.conversationSummary ?? "",
  ].filter((h) => h.trim());

  for (const haystack of haystacks) {
    for (const id of matchOrganisationIdsInText(haystack, input.organisations)) {
      push(id);
      if (ordered.length >= limit) return ordered.slice(0, limit);
    }
  }

  return ordered.slice(0, limit);
}

export function formatOrganisationDirectoryForPrompt(
  organisations: SurveyAssistantOrgDirectoryEntry[],
): string {
  if (organisations.length === 0) {
    return "Keine Organisationen vorhanden.";
  }

  const lines = organisations.map((org, i) => {
    const label = org.displayName?.trim() || org.name;
    const parts = [
      `${i + 1}. ${label}`,
      `id=${org.id}`,
    ];
    if (org.slug?.trim()) parts.push(`slug=${org.slug.trim()}`);
    if (org.websiteUrl?.trim()) parts.push(`website=${org.websiteUrl.trim()}`);
    parts.push(`crawl=${org.crawlPageCount} Seiten`);
    if (org.lastCrawlStatus) {
      const when = org.lastCrawledAt
        ? ` ${org.lastCrawledAt.slice(0, 10)}`
        : "";
      parts.push(`letzter Crawl: ${org.lastCrawlStatus}${when}`);
    }
    parts.push(`offene Aufgaben: ${org.openTaskCount}`);
    if (org.inProgressTaskCount > 0) {
      parts.push(`in Arbeit: ${org.inProgressTaskCount}`);
    }
    return parts.join(" | ");
  });

  return [
    `Alle Organisationen (${organisations.length}). Du darfst jede davon per id/Name nachladen.`,
    ...lines,
  ].join("\n");
}

export function formatOpenSeoTasksForSurveyAssistant(
  tasks: WorkspaceTask[],
): string {
  const active = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  if (active.length === 0) {
    return "Keine offenen oder laufenden SEO-Aufgaben.";
  }

  const label = (status: WorkspaceTask["status"]) =>
    status === "in_progress" ? "In Arbeit" : "Offen";

  return [
    `${active.length} offene/laufende SEO-Aufgaben:`,
    ...active.map((task) => {
      const parts = [
        `id=${task.id}`,
        `[${label(task.status)}] ${task.title.trim()}`,
      ];
      if (task.keyword?.trim()) parts.push(`Keyword: ${task.keyword.trim()}`);
      if (task.url?.trim()) parts.push(`URL: ${task.url.trim()}`);
      if (task.priority?.trim()) parts.push(`Prio: ${task.priority.trim()}`);
      if (task.current_status?.trim()) parts.push(`Ist: ${task.current_status.trim()}`);
      if (task.action?.trim()) {
        const action =
          task.action.trim().length > 160
            ? `${task.action.trim().slice(0, 159)}…`
            : task.action.trim();
        parts.push(`Maßnahme: ${action}`);
      }
      return `- ${parts.join(" | ")}`;
    }),
  ].join("\n");
}

export function formatSitePageIndexForSurveyAssistant(pages: WorkspaceSitePage[]): string {
  if (pages.length === 0) {
    return "Noch keine Unterseiten gecrawlt.";
  }
  const sliced = pages.slice(0, MAX_SITE_PAGE_INDEX);
  const lines = sliced.map((p, i) => {
    const title = (p.title?.trim() || p.h1?.trim() || "").slice(0, 80);
    return title && title !== p.url ? `${i + 1}. ${title} — ${p.url}` : `${i + 1}. ${p.url}`;
  });
  const extra =
    pages.length > sliced.length
      ? `\n… und ${pages.length - sliced.length} weitere (per search_website_content / read_website_page laden).`
      : "";
  return `Gecrawlte Unterseiten (${pages.length}):\n${lines.join("\n")}${extra}`;
}

export function formatFocusedOrgWorkspaceForPrompt(
  focused: SurveyAssistantFocusedOrgWorkspace[],
): string {
  if (focused.length === 0) {
    return [
      "Kein fokussierter Organisations-Kontext in diesem Turn.",
      "Wenn der Nutzer eine Organisation, Website, Crawl oder offene Aufgaben meint: Organisation anhand „Known organisations“ zuordnen und lookup_organisation_workspace / search_website_content / read_website_page nutzen.",
      "Behaupte NIEMALS, du hättest keinen Zugriff auf Crawl, Organisationen oder Aufgaben.",
    ].join("\n");
  }

  return focused
    .map((org) =>
      [
        `### ${org.organisationName} (${org.organisationId})`,
        org.websiteUrl ? `Website: ${org.websiteUrl}` : "Website: (nicht hinterlegt)",
        `Crawl-Seiten: ${org.crawlPageCount}`,
        "",
        "## Crawl / Website-Inhalt",
        org.crawlSummary.trim() || "Kein Crawl-Inhalt vorhanden.",
        "",
        "## Seitenindex",
        org.sitePageIndex,
        "",
        "## Offene Aufgaben",
        org.openTasks,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
