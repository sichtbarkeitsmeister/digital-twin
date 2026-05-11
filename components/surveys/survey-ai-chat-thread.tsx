"use client";

import { CheckCircle2, Sparkles, XCircle } from "lucide-react";

import type { AiChatAction } from "@/components/surveys/survey-ai-action-trace";
import { SurveyAiActionTrace } from "@/components/surveys/survey-ai-action-trace";
import { SurveyChatMarkdown } from "@/components/surveys/survey-chat-markdown";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

function parseProposal(content: string) {
  try {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const normalized = (fenced?.[1] ?? content).trim();
    const parsed = JSON.parse(normalized) as { kind?: unknown; summary?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function getProposalSummary(value: unknown) {
  if (!value || typeof value !== "object") return "Vorschlag";
  const maybe = value as { summary?: unknown; kind?: unknown };
  if (typeof maybe.summary === "string" && maybe.summary.trim()) return maybe.summary.trim();
  if (typeof maybe.kind === "string" && maybe.kind.trim()) return maybe.kind.trim();
  return "Vorschlag";
}

function describeBatchStepInPlainLanguage(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Schritt";
  const s = raw as {
    kind?: unknown;
    summary?: unknown;
    name?: unknown;
    title?: unknown;
  };
  const kind = typeof s.kind === "string" ? s.kind : "";
  const summary = typeof s.summary === "string" ? s.summary.trim() : "";
  const name = typeof s.name === "string" ? s.name.trim() : "";
  const title = typeof s.title === "string" ? s.title.trim() : "";

  if (kind === "create_folder") {
    if (summary) return summary;
    if (name) return `Ordner „${name}“ anlegen`;
    return "Neuen Ordner anlegen";
  }
  if (kind === "create_survey") {
    if (summary) return summary;
    if (title) return `Neue Umfrage: ${title}`;
    return "Neue Umfrage anlegen";
  }
  if (kind === "assign_folder") {
    if (summary) return summary;
    return "Umfrage einem Ordner zuordnen";
  }
  if (kind === "publish") {
    if (summary) return summary;
    return "Umfrage veröffentlichen";
  }
  if (kind === "unpublish") {
    if (summary) return summary;
    return "Umfrage nicht mehr öffentlich schalten";
  }
  if (kind === "patch_survey_definition") {
    if (summary) return summary;
    return "Umfrage gezielt bearbeiten (Patch)";
  }
  if (kind === "edit_survey_definition") {
    if (summary) return summary;
    return "Umfrage-Inhalt ersetzen";
  }
  if (kind === "rename_folder") {
    if (summary) return summary;
    return "Ordner umbenennen";
  }
  if (kind === "delete_folder") {
    if (summary) return summary;
    return "Ordner löschen";
  }
  if (kind === "update_survey_metadata") {
    if (summary) return summary;
    return "Titel oder Beschreibung einer Umfrage ändern";
  }
  if (kind === "delete_survey") {
    if (summary) return summary;
    return "Umfrage archivieren";
  }
  if (summary) return summary;
  return "Schritt";
}

function getFriendlyProposalLines(value: unknown, action?: AiChatAction | null) {
  if (!value || typeof value !== "object") return [];
  const proposal = value as {
    kind?: unknown;
    surveyId?: unknown;
    folderId?: unknown;
    title?: unknown;
    name?: unknown;
    operations?: unknown;
    steps?: unknown;
    summary?: unknown;
  };
  const lines: string[] = [];
  if (typeof proposal.kind === "string") {
    const kindLabel: Record<string, string> = {
      patch_survey_definition: "Gezielte Bearbeitung bestehender Umfrage",
      edit_survey_definition: "Umfrage-Inhalt umfassend aktualisieren",
      create_survey: "Neue Umfrage erstellen",
      create_folder: "Neuen Ordner erstellen",
      rename_folder: "Ordner umbenennen",
      delete_folder: "Ordner löschen",
      batch: "Mehrere zusammengehörige Schritte",
      update_survey_metadata: "Titel/Beschreibung anpassen",
      assign_folder: "Umfrage einem Ordner zuordnen",
      publish: "Umfrage veröffentlichen",
      unpublish: "Umfrage auf privat setzen",
      delete_survey: "Umfrage löschen",
    };
    lines.push(`Aktion: ${kindLabel[proposal.kind] ?? proposal.kind}`);
  }

  if (proposal.kind === "batch" && Array.isArray(proposal.steps)) {
    const n = proposal.steps.length;
    lines.push(
      `${n} Schritte werden nach deiner Freigabe nacheinander ausgeführt (ein Klick für alles).`,
    );
    proposal.steps.forEach((raw, idx) => {
      lines.push(`${idx + 1}. ${describeBatchStepInPlainLanguage(raw)}`);
    });
    return lines;
  }

  if (typeof proposal.surveyId === "string") {
    const surveyTitle = action?.proposal_survey_title?.trim();
    lines.push(
      surveyTitle
        ? `Betroffene Umfrage: ${surveyTitle} (${proposal.surveyId})`
        : `Betroffene Umfrage: ${proposal.surveyId}`,
    );
  }
  if (typeof proposal.folderId === "string") {
    lines.push(`Betroffener Ordner-ID: ${proposal.folderId}`);
  }
  if (typeof proposal.title === "string") lines.push(`Neuer Titel: ${proposal.title}`);
  if (typeof proposal.name === "string") lines.push(`Ordnername: ${proposal.name}`);
  if (Array.isArray(proposal.operations)) {
    const opCounts = proposal.operations.reduce(
      (acc, op) => {
        if (op && typeof op === "object" && typeof (op as { op?: unknown }).op === "string") {
          const key = (op as { op: string }).op;
          acc[key] = (acc[key] ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
    const opNames: Record<string, string> = {
      update_field: "Feld aktualisieren",
      add_field: "Feld hinzufügen",
      delete_field: "Feld löschen",
      update_step: "Schritt aktualisieren",
      add_step: "Schritt hinzufügen",
      delete_step: "Schritt löschen",
    };
    lines.push(`Geplante Änderungen: ${proposal.operations.length}`);
    Object.entries(opCounts).forEach(([key, count]) => {
      lines.push(`- ${count}x ${opNames[key] ?? key}`);
    });
  }
  return lines;
}

function getActionStateLabel(action: AiChatAction | null) {
  if (!action) return null;
  if (action.execution_status === "applied") return "Vorschlag angenommen";
  if (action.execution_status === "reverted") return "Änderung rückgängig";
  if (action.execution_status === "failed") {
    const resultMessage =
      action.execution_result &&
      typeof action.execution_result === "object" &&
      typeof (action.execution_result as { message?: unknown }).message === "string"
        ? ((action.execution_result as { message: string }).message)
        : "";
    if (resultMessage.toLowerCase().includes("abgelehnt")) return "Vorschlag abgelehnt";
    return "Aktion fehlgeschlagen";
  }
  if (action.execution_status === "proposed") return "Wartet auf Freigabe";
  return null;
}

export function SurveyAiChatThread(props: {
  messages: AiChatMessage[];
  actions: AiChatAction[];
  isAssistantThinking: boolean;
  thinkingStatus: string | null;
  pendingActionId: string | null;
  onApplyAction: (actionId: string) => void;
  onRevertAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      {props.messages.map((msg) => {
        const relatedActions = props.actions.filter((a) => a.message_id === msg.id);
        const proposedAction = relatedActions.find((a) => a.execution_status === "proposed") ?? null;
        const latestAction = relatedActions.length > 0 ? relatedActions[relatedActions.length - 1] : null;
        const parsedProposal = msg.role === "assistant" ? parseProposal(msg.content) : null;
        const roleLabel =
          msg.role === "assistant" ? "Assistent" : msg.role === "user" ? "Du" : "System";
        const proposalData = proposedAction?.proposal_json ?? latestAction?.proposal_json ?? parsedProposal;
        const proposalTitle = getProposalSummary(proposalData);
        const proposalLines = getFriendlyProposalLines(proposalData, proposedAction ?? latestAction);
        const actionStateLabel = getActionStateLabel(latestAction);
        const isUser = msg.role === "user";
        const surveyLine = proposalLines.find((line) => line.startsWith("Betroffene Umfrage: "));
        const otherLines = proposalLines.filter((line) => !line.startsWith("Betroffene Umfrage: "));
        const surveyLabel =
          proposedAction?.proposal_survey_title ||
          latestAction?.proposal_survey_title ||
          null;
        const surveyId =
          proposedAction?.proposal_survey_id ||
          latestAction?.proposal_survey_id ||
          (proposalData && typeof proposalData === "object" && typeof (proposalData as { surveyId?: unknown }).surveyId === "string"
            ? (proposalData as { surveyId: string }).surveyId
            : null);
        return (
          <div key={msg.id} className="grid gap-2">
            <div
              className={`max-w-[86%] rounded-3xl px-4 py-3 text-sm shadow-sm transition ${
                isUser
                  ? "ml-auto border border-primary/35 bg-primary/15"
                  : msg.role === "assistant"
                    ? "border border-border/80 bg-card"
                    : "border border-border/80 bg-muted/60"
              }`}
            >
              <p className="mb-1 text-[11px] uppercase tracking-wide text-secondary">{roleLabel}</p>
              {parsedProposal ? (
                <div className="grid gap-2">
                  <p className="text-sm">
                    Ich habe einen Vorschlag vorbereitet: <span className="font-medium">{proposalTitle}</span>
                  </p>
                </div>
              ) : msg.role === "assistant" ? (
                <SurveyChatMarkdown content={msg.content} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              <p className="mt-2 text-[11px] text-secondary">{new Date(msg.created_at).toLocaleString()}</p>
            </div>
            {proposalData ? (
              <div className="max-w-[92%] rounded-3xl border border-primary/25 bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-secondary" />
                      Vorgeschlagene Änderung
                    </p>
                    <p className="mt-1 text-xs text-secondary">{proposalTitle}</p>
                  </div>
                  {actionStateLabel ? (
                    <p className="rounded-md bg-muted px-2 py-1 text-[11px] text-secondary">
                      {actionStateLabel}
                    </p>
                  ) : null}
                </div>
                {surveyLabel && surveyId ? (
                  <p className="mt-2 text-xs text-secondary">
                    Betroffene Umfrage:{" "}
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium" title={surveyId}>
                      {surveyLabel}
                    </span>
                  </p>
                ) : surveyLine ? (
                  <p className="mt-2 text-xs text-secondary">{surveyLine}</p>
                ) : null}
                {proposalLines.length > 0 ? (
                  <ul className="mt-2 grid gap-1 text-xs text-secondary">
                    {otherLines.map((line) => (
                      <li key={line}>- {line}</li>
                    ))}
                  </ul>
                ) : null}

                <details className="mt-2 min-w-0">
                  <summary className="cursor-pointer text-xs text-secondary">
                    Technische Ansicht (JSON)
                  </summary>
                  <pre className="scrollbar-subtle mt-2 max-h-56 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px]">
                    {JSON.stringify(proposalData, null, 2)}
                  </pre>
                </details>

                {proposedAction ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
                      disabled={props.pendingActionId === proposedAction.id}
                      onClick={() => props.onApplyAction(proposedAction.id)}
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      Annehmen
                    </button>
                    <button
                      type="button"
                      className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-60"
                      disabled={props.pendingActionId === proposedAction.id}
                      onClick={() => props.onRejectAction(proposedAction.id)}
                    >
                      <XCircle className="mr-1 inline h-3.5 w-3.5" />
                      Ablehnen
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {relatedActions.length > 0 ? (
              <SurveyAiActionTrace
                actions={relatedActions.filter((a) => a.execution_status !== "proposed")}
                onApplyAction={props.onApplyAction}
                onRevertAction={props.onRevertAction}
                pendingActionId={props.pendingActionId}
              />
            ) : null}
          </div>
        );
      })}

      {props.isAssistantThinking ? (
        <div
          className="flex max-w-[92%] items-center gap-3 py-1 text-sm"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="animate-ai-thinking-ring h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 leading-snug text-muted-foreground">
            <span className="animate-ai-thinking-shimmer inline-block max-w-full align-middle">
              {props.thinkingStatus ?? "Denkt kurz nach …"}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

