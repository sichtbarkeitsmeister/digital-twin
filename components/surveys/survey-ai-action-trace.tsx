"use client";

import { Button } from "@/components/ui/button";

export type AiChatAction = {
  id: string;
  message_id: string | null;
  proposal_kind: string;
  proposal_json: unknown;
  proposal_survey_id?: string | null;
  proposal_survey_title?: string | null;
  execution_status: "proposed" | "applied" | "reverted" | "failed";
  execution_result: unknown;
  revert_payload: unknown;
  created_at: string;
};

function getSummary(a: AiChatAction) {
  const proposal = (a.proposal_json ?? {}) as { summary?: unknown; kind?: unknown };
  if (typeof proposal.summary === "string" && proposal.summary.trim()) return proposal.summary;
  if (typeof proposal.kind === "string" && proposal.kind.trim()) return proposal.kind;
  return a.proposal_kind;
}

function getStatusLabel(a: AiChatAction) {
  if (a.execution_status === "applied") return "Vorschlag angenommen";
  if (a.execution_status === "reverted") return "Änderung rückgängig";
  if (a.execution_status === "proposed") return "Wartet auf Freigabe";
  if (a.execution_status === "failed") {
    const message =
      a.execution_result &&
      typeof a.execution_result === "object" &&
      typeof (a.execution_result as { message?: unknown }).message === "string"
        ? ((a.execution_result as { message: string }).message)
        : "";
    if (message.toLowerCase().includes("abgelehnt")) return "Vorschlag abgelehnt";
    return "Aktion fehlgeschlagen";
  }
  return a.execution_status;
}

function isRejectedFailure(a: AiChatAction) {
  if (a.execution_status !== "failed") return false;
  const message =
    a.execution_result &&
    typeof a.execution_result === "object" &&
    typeof (a.execution_result as { message?: unknown }).message === "string"
      ? ((a.execution_result as { message: string }).message)
      : "";
  return message.toLowerCase().includes("abgelehnt");
}

function getStatusClass(a: AiChatAction) {
  if (a.execution_status === "applied") return "bg-primary/15 text-primary";
  if (a.execution_status === "reverted") return "bg-muted text-secondary";
  if (a.execution_status === "failed") return "bg-destructive/15 text-destructive";
  return "bg-muted text-secondary";
}

export function SurveyAiActionTrace(props: {
  actions: AiChatAction[];
  onApplyAction: (actionId: string) => void;
  onRevertAction: (actionId: string) => void;
  pendingActionId: string | null;
}) {
  if (props.actions.length === 0) return null;
  return (
    <div className="grid gap-2 rounded-2xl border border-border/70 bg-card/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Aktionsverlauf</p>
      {props.actions.map((a) => (
        <div key={a.id} className="rounded-xl border border-border/70 bg-background/70 p-3 text-xs">
          {(() => {
            const hideRevert = isRejectedFailure(a);
            const hideApply = isRejectedFailure(a) || a.execution_status !== "proposed";
            const hasRevertPayload =
              a.revert_payload != null &&
              typeof a.revert_payload === "object" &&
              !Array.isArray(a.revert_payload);
            const canRevert =
              (a.execution_status === "applied" || a.execution_status === "failed") &&
              !hideRevert &&
              props.pendingActionId !== a.id &&
              hasRevertPayload;
            return (
              <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-foreground">{getSummary(a)}</p>
            <p className={`rounded-md px-2 py-0.5 text-[11px] ${getStatusClass(a)}`}>{getStatusLabel(a)}</p>
          </div>
          <details className="mt-2 min-w-0">
            <summary className="cursor-pointer text-[11px] text-secondary">Technische Ansicht (JSON)</summary>
            <pre className="scrollbar-subtle mt-2 max-h-36 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px]">
              {JSON.stringify(a.proposal_json, null, 2)}
            </pre>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            {!hideApply ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={a.execution_status !== "proposed" || props.pendingActionId === a.id}
                onClick={() => props.onApplyAction(a.id)}
              >
                Annehmen
              </Button>
            ) : null}
            {!hideRevert ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canRevert}
                onClick={() => props.onRevertAction(a.id)}
              >
                Rückgängig
              </Button>
            ) : null}
          </div>
              </>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

