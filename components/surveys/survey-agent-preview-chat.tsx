"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ClipboardList, Loader2, MessageCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyExamQuestion } from "@/lib/dt/survey-exam-questions";
import { cn } from "@/lib/utils";

type PreviewChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function SurveyAgentPreviewChat(props: {
  organisationId: string;
  agentName: string;
  agentRole: string | null;
  promptTemplate: string;
  surveyId?: string;
  responseId?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [messages, setMessages] = useState<PreviewChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examQuestions, setExamQuestions] = useState<SurveyExamQuestion[]>([]);
  const [examLoading, setExamLoading] = useState(false);
  const [sentExamIds, setSentExamIds] = useState<Set<string>>(() => new Set());
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const promptKeyRef = useRef(props.promptTemplate);

  // Reset thread when the preview persona changes substantially.
  useEffect(() => {
    if (promptKeyRef.current === props.promptTemplate) return;
    promptKeyRef.current = props.promptTemplate;
    setMessages([]);
    setError(null);
    setSentExamIds(new Set());
    setActiveHint(null);
  }, [props.promptTemplate, props.agentName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  useEffect(() => {
    if (!props.surveyId || !props.responseId) {
      setExamQuestions([]);
      return;
    }
    let cancelled = false;
    setExamLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/surveys/${props.surveyId}/responses/${props.responseId}/exam-questions`,
        );
        const json = (await res.json()) as {
          ok?: boolean;
          questions?: SurveyExamQuestion[];
        };
        if (cancelled) return;
        if (json.ok && json.questions) setExamQuestions(json.questions);
        else setExamQuestions([]);
      } catch {
        if (!cancelled) setExamQuestions([]);
      } finally {
        if (!cancelled) setExamLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.surveyId, props.responseId]);

  const sendContent = useCallback(
    async (content: string, examId?: string, expectedHint?: string) => {
      const text = content.trim();
      if (!text || busy || props.disabled) return;
      if (!props.organisationId) {
        setError("Bitte zuerst eine Organisation wählen.");
        return;
      }
      if (props.promptTemplate.trim().length < 40) {
        setError("Persona-Prompt ist noch zu kurz für einen Probe-Chat.");
        return;
      }

      const userMsg: PreviewChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
      };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg]);
      setDraft("");
      setBusy(true);
      setError(null);
      if (expectedHint) setActiveHint(expectedHint);
      if (examId) {
        setSentExamIds((prev) => {
          const next = new Set(prev);
          next.add(examId);
          return next;
        });
      }

      try {
        const res = await fetch("/api/dt/preview-agent-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organisationId: props.organisationId,
            name: props.agentName,
            role: props.agentRole,
            promptTemplate: props.promptTemplate,
            content: text,
            history,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          reply?: string;
          message?: string;
        };
        if (!json.ok || !json.reply?.trim()) {
          setError(json.message ?? "Antwort fehlgeschlagen.");
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: json.reply!.trim(),
          },
        ]);
      } catch {
        setError("Netzwerkfehler — bitte erneut versuchen.");
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      messages,
      props.agentName,
      props.agentRole,
      props.disabled,
      props.organisationId,
      props.promptTemplate,
    ],
  );

  const openExamQuestions = examQuestions.filter((q) => !sentExamIds.has(q.id));
  const nextExam = openExamQuestions[0] ?? null;

  return (
    <Card
      className={cn(
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]",
        props.className,
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4 text-sbkm-mint" aria-hidden />
          Probe-Chat / Prüfung mit {props.agentName}
        </CardTitle>
        <CardDescription>
          Fragebogen-Fragen als Prüfskript — tippe oder klicke eine Frage. Antworten werden
          nicht gespeichert; nutzt den aktuellen Persona-Prompt.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {props.surveyId && props.responseId ? (
          <div className="grid gap-2 rounded-xl border border-sbkm-mint/25 bg-sbkm-mint/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sbkm-navy/70 dark:text-white/60">
                <ClipboardList className="size-3.5" aria-hidden />
                Prüfungsfragen aus dem Fragebogen
              </p>
              {nextExam ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || props.disabled || examLoading}
                  onClick={() =>
                    void sendContent(nextExam.question, nextExam.id, nextExam.expectedHint)
                  }
                  className="gap-1.5"
                >
                  Nächste Frage stellen
                </Button>
              ) : examQuestions.length > 0 ? (
                <span className="flex items-center gap-1 text-xs font-medium text-sbkm-mint">
                  <Check className="size-3.5" aria-hidden />
                  Alle Fragen gestellt
                </span>
              ) : null}
            </div>

            {examLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Fragen werden vorbereitet …
              </p>
            ) : openExamQuestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {openExamQuestions.slice(0, 8).map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy || props.disabled}
                    title={q.expectedHint}
                    onClick={() => void sendContent(q.question, q.id, q.expectedHint)}
                    className="max-w-full rounded-full border border-sbkm-navy/15 bg-white px-3 py-1.5 text-left text-xs font-medium text-sbkm-navy transition hover:border-sbkm-mint hover:bg-sbkm-mint/10 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-sbkm-mint/15"
                  >
                    <span className="line-clamp-2">{q.question}</span>
                  </button>
                ))}
                {openExamQuestions.length > 8 ? (
                  <span className="self-center text-xs text-muted-foreground">
                    +{openExamQuestions.length - 8} weitere über „Nächste Frage“
                  </span>
                ) : null}
              </div>
            ) : examQuestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine Prüfungsfragen aus der Umfrage abgeleitet.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Nachrichten. Starte mit „Nächste Frage stellen“ oder tippe selbst.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-sbkm-navy text-white"
                    : "mr-auto bg-white text-sbkm-navy shadow-sm dark:bg-white/10 dark:text-white",
                )}
              >
                {m.content}
              </div>
            ))
          )}
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {props.agentName} antwortet …
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {activeHint && !busy ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            <span className="font-semibold">Erwartung aus Fragebogen:</span> {activeHint}
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Eigene Frage an ${props.agentName}…`}
            rows={2}
            disabled={busy || props.disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendContent(draft);
              }
            }}
            className="min-h-[72px] flex-1"
          />
          <Button
            type="button"
            disabled={busy || props.disabled || !draft.trim()}
            onClick={() => void sendContent(draft)}
            className="shrink-0 gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            Fragen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
