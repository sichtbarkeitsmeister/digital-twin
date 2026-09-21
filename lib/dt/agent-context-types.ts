export type DtAgentContextSourceType =
  | "system"
  | "agent"
  | "organisation"
  | "user"
  | "crawl"
  | "report"
  | "analytics"
  | "tasks"
  | "dynamic";

export type DtAgentContextMode = "default" | "seo" | "team";

export type DtAgentContextSection = {
  id: string;
  title: string;
  sourceLabel: string;
  sourceType: DtAgentContextSourceType;
  description: string;
  content: string;
  isEmpty: boolean;
  editHref?: string;
  meta?: Record<string, string | number>;
};

export type DtAgentContextBundle = {
  organisationId: string;
  organisationName: string;
  agentId: string;
  agentName: string;
  agentKind: string;
  mode: DtAgentContextMode;
  textMode: boolean;
  textModePrompt: string;
  textModePromptIsDefault: boolean;
  sections: DtAgentContextSection[];
  excludedNote: string;
  assembledPreviewChars: number;
};

export function estimateSectionChars(content: string): number {
  return content.trim().length;
}
