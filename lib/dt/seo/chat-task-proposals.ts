import { z } from "zod";

const proposalSchema = z.object({
  title: z.string().trim().min(1).max(500),
  keyword: z.string().trim().max(200).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  current_status: z.string().trim().max(500).nullable().optional(),
  action: z.string().trim().min(1).max(2000),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
});

export type DtSeoChatTaskProposal = z.infer<typeof proposalSchema>;

const DT_TASKS_FENCE_RE = /```(?:dt-tasks|json:dt-tasks)\s*\n([\s\S]*?)```/gi;

function normalizeProposal(raw: unknown): DtSeoChatTaskProposal | null {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const keyword = p.keyword?.trim() || null;
  const url = p.url?.trim() || null;
  if (!keyword && !url) return null;
  return {
    title: p.title.trim(),
    keyword,
    url,
    current_status: p.current_status?.trim() || null,
    action: p.action.trim(),
    priority: p.priority ?? null,
  };
}

export function parseDtSeoTaskProposalsFromText(text: string): DtSeoChatTaskProposal[] {
  const proposals: DtSeoChatTaskProposal[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(DT_TASKS_FENCE_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      const json = JSON.parse(body) as unknown;
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const normalized = normalizeProposal(item);
        if (!normalized) continue;
        const key = `${normalized.title}|${normalized.keyword ?? ""}|${normalized.url ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        proposals.push(normalized);
      }
    } catch {
      continue;
    }
  }

  return proposals.slice(0, 6);
}

export function stripDtSeoTaskProposalBlocks(text: string): string {
  return text.replace(DT_TASKS_FENCE_RE, "").trimEnd();
}

export function extractDtSeoTaskProposalsFromMessage(input: {
  content: string;
  metadata?: Record<string, unknown> | null;
}): DtSeoChatTaskProposal[] {
  const rawMeta = input.metadata?.seo_task_proposals;
  if (Array.isArray(rawMeta) && rawMeta.length > 0) {
    const fromMeta = rawMeta
      .map((item) => normalizeProposal(item))
      .filter((item): item is DtSeoChatTaskProposal => item != null);
    if (fromMeta.length > 0) return fromMeta.slice(0, 6);
  }
  return parseDtSeoTaskProposalsFromText(input.content);
}

export function buildDtSeoTaskProposalMetadata(proposals: DtSeoChatTaskProposal[]) {
  return proposals.slice(0, 6);
}

function normalizeFingerprintPart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function seoTaskProposalFingerprint(proposal: DtSeoChatTaskProposal): string {
  return [
    normalizeFingerprintPart(proposal.title),
    normalizeFingerprintPart(proposal.keyword),
    normalizeFingerprintPart(proposal.url),
    normalizeFingerprintPart(proposal.action),
  ].join("|");
}

export function seoTaskRowFingerprint(task: {
  title: string;
  keyword?: string | null;
  url?: string | null;
  action?: string | null;
}): string {
  return [
    normalizeFingerprintPart(task.title),
    normalizeFingerprintPart(task.keyword),
    normalizeFingerprintPart(task.url),
    normalizeFingerprintPart(task.action),
  ].join("|");
}

export type DtSeoTaskProposalMatchRow = {
  message_id: string | null;
  title: string;
  keyword: string | null;
  url: string | null;
  action: string | null;
};

/** Returns proposal indexes that already exist as saved tasks for this message or org board. */
export function matchSavedSeoTaskProposalIndexes(input: {
  proposals: DtSeoChatTaskProposal[];
  messageId: string;
  tasks: DtSeoTaskProposalMatchRow[];
}): number[] {
  const saved = new Set<number>();
  const messageFingerprints = new Set<string>();
  const orgFingerprints = new Set<string>();

  for (const task of input.tasks) {
    const fp = seoTaskRowFingerprint(task);
    orgFingerprints.add(fp);
    if (task.message_id === input.messageId) {
      messageFingerprints.add(fp);
    }
  }

  input.proposals.forEach((proposal, index) => {
    const fp = seoTaskProposalFingerprint(proposal);
    if (messageFingerprints.has(fp) || orgFingerprints.has(fp)) {
      saved.add(index);
    }
  });

  return [...saved];
}

export function filterUnsavedSeoTaskProposals(input: {
  proposals: DtSeoChatTaskProposal[];
  messageId: string;
  tasks: DtSeoTaskProposalMatchRow[];
}): DtSeoChatTaskProposal[] {
  const savedIndexes = new Set(matchSavedSeoTaskProposalIndexes(input));
  return input.proposals.filter((_, index) => !savedIndexes.has(index));
}
