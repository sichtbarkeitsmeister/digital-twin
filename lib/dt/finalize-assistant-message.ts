import {
  buildDtChatArtifactMetadata,
  parseDtChatArtifactsFromText,
  stripDtChatArtifactBlocks,
  type DtChatArtifact,
} from "@/lib/dt/chat-artifacts";
import {
  buildDtSeoTaskProposalMetadata,
  parseDtSeoTaskProposalsFromText,
  stripDtSeoTaskProposalBlocks,
  type DtSeoChatTaskProposal,
} from "@/lib/dt/seo/chat-task-proposals";
import type { DtChatMode } from "@/lib/dt/types";

export type DtFinalizedAssistantContent = {
  content: string;
  artifacts: DtChatArtifact[];
  seoTaskProposals: DtSeoChatTaskProposal[];
};

export function finalizeDtAssistantContent(
  text: string,
  mode: DtChatMode | string,
): DtFinalizedAssistantContent {
  const artifacts = parseDtChatArtifactsFromText(text);
  const seoTaskProposals =
    mode === "seo" ? parseDtSeoTaskProposalsFromText(text) : [];
  let content = stripDtChatArtifactBlocks(text);
  if (mode === "seo") content = stripDtSeoTaskProposalBlocks(content);
  return {
    content: content.replace(/\n{3,}/g, "\n\n").trimEnd(),
    artifacts,
    seoTaskProposals,
  };
}

export function assistantMessageMetadataExtras(
  base: Record<string, unknown>,
  input: {
    mode: DtChatMode | string;
    seoTaskProposals: DtSeoChatTaskProposal[];
    artifacts: DtChatArtifact[];
  },
): Record<string, unknown> {
  const next = { ...base };
  if (input.mode === "seo" && input.seoTaskProposals.length > 0) {
    next.seo_task_proposals = buildDtSeoTaskProposalMetadata(input.seoTaskProposals);
  }
  if (input.artifacts.length > 0) {
    next.chat_artifacts = buildDtChatArtifactMetadata(input.artifacts);
  }
  return next;
}
