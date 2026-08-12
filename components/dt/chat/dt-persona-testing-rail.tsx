"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import type { ExamAnswerCheckSuggestion } from "@/lib/dt/exam-answer-check";
import { personaTestingModeTitle } from "@/lib/dt/persona-testing";
import type {
  SurveyExamAudience,
  SurveyExamQuestion,
} from "@/lib/dt/survey-exam-questions";

export type PersonaExamVerdict = "pass" | "fail" | null;

type ReplyPhase = "idle" | "pending_send" | "in_flight" | "checked";

type AskedExam = SurveyExamQuestion & {
  verdict: PersonaExamVerdict;
  replyPhase: ReplyPhase;
  aiSuggestion?: ExamAnswerCheckSuggestion | null;
  aiError?: string | null;
};

/**
 * Collapsible testing rail beside the chat: question bank, expected
 * questionnaire answer, AI SOLL/IST hint, and human final verdict.
 */
export function DtPersonaTestingRail(props: {
  agentId: string;
  enabled: boolean;
  isBusy?: boolean;
  disabled?: boolean;
  /** Latest assistant reply in the active chat — used for AI SOLL/IST check. */
  lastAssistantContent?: string | null;
  /** Latest user message — used to match the active exam question. */
  lastUserContent?: string | null;
  onPickQuestion: (question: string) => void;
  className?: string;
}) {
  const [questions, setQuestions] = useState<SurveyExamQuestion[]>([]);
  const [audience, setAudience] = useState<SurveyExamAudience>("persona");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<AskedExam[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const lastCheckedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!props.enabled) {
      setQuestions([]);
      setAudience("persona");
      setError(null);
      setAsked([]);
      setActiveId(null);
      setExpanded(true);
      setChecking(false);
      lastCheckedKeyRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAsked([]);
    setActiveId(null);
    setExpanded(true);
    lastCheckedKeyRef.current = null;

    void (async () => {
      try {
        const res = await fetch(`/api/dt/agents/${props.agentId}/exam-questions`);
        const json = (await res.json()) as {
          ok?: boolean;
          available?: boolean;
          audience?: SurveyExamAudience;
          questions?: SurveyExamQuestion[];
          message?: string;
        };
        if (cancelled) return;
        if (!json.ok) {
          setQuestions([]);
          setError(json.message ?? "Prüfungsfragen konnten nicht geladen werden.");
          return;
        }
        setAudience(json.audience === "company" ? "company" : "persona");
        setQuestions(json.questions ?? []);
        if (!json.available || !(json.questions?.length ?? 0)) {
          setError("Keine Prüfungsfragen aus der Umfrage abgeleitet.");
        }
      } catch {
        if (!cancelled) {
          setQuestions([]);
          setError("Prüfungsfragen konnten nicht geladen werden.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.enabled, props.agentId]);

  const askedIds = useMemo(() => new Set(asked.map((q) => q.id)), [asked]);
  const openQuestions = useMemo(
    () => questions.filter((q) => !askedIds.has(q.id)),
    [questions, askedIds],
  );
  const active = asked.find((q) => q.id === activeId) ?? asked[asked.length - 1] ?? null;
  const nextQuestion = openQuestions[0] ?? null;
  const title = personaTestingModeTitle(audience === "company" ? "company" : "persona");
  const passCount = asked.filter((q) => q.verdict === "pass").length;
  const failCount = asked.filter((q) => q.verdict === "fail").length;

  function pick(q: SurveyExamQuestion) {
    if (props.isBusy || props.disabled) return;
    props.onPickQuestion(q.question);
    setAsked((prev) => {
      if (prev.some((p) => p.id === q.id)) {
        return prev.map((p) =>
          p.id === q.id
            ? {
                ...p,
                verdict: null,
                replyPhase: "pending_send",
                aiSuggestion: null,
                aiError: null,
              }
            : p,
        );
      }
      return [
        ...prev,
        {
          ...q,
          verdict: null,
          replyPhase: "pending_send",
          aiSuggestion: null,
          aiError: null,
        },
      ];
    });
    setActiveId(q.id);
    setExpanded(true);
    lastCheckedKeyRef.current = null;
  }

  function setVerdict(id: string, verdict: Exclude<PersonaExamVerdict, null>) {
    setAsked((prev) => prev.map((q) => (q.id === id ? { ...q, verdict } : q)));
  }

  async function runAiCheck(exam: AskedExam, assistantAnswer: string, force = false) {
    const key = `${exam.id}::${assistantAnswer.slice(0, 120)}`;
    if (!force && lastCheckedKeyRef.current === key) return;
    lastCheckedKeyRef.current = key;
    setChecking(true);
    try {
      const res = await fetch("/api/dt/exam-answer-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: exam.question,
          expectedHint: exam.expectedHint,
          assistantAnswer,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        suggestion?: ExamAnswerCheckSuggestion;
        message?: string;
      };
      setAsked((prev) =>
        prev.map((q) =>
          q.id === exam.id
            ? {
                ...q,
                replyPhase: "checked",
                aiSuggestion: json.ok && json.suggestion ? json.suggestion : null,
                aiError: json.ok ? null : (json.message ?? "KI-Prüfung fehlgeschlagen."),
              }
            : q,
        ),
      );
    } catch {
      setAsked((prev) =>
        prev.map((q) =>
          q.id === exam.id
            ? {
                ...q,
                replyPhase: "checked",
                aiSuggestion: null,
                aiError: "KI-Prüfung fehlgeschlagen.",
              }
            : q,
        ),
      );
    } finally {
      setChecking(false);
    }
  }

  // Mark in-flight once the twin starts answering the pending exam question.
  useEffect(() => {
    if (!props.enabled || !active) return;
    if (!props.isBusy) return;
    if (active.replyPhase !== "pending_send") return;
    setAsked((prev) =>
      prev.map((q) => (q.id === active.id ? { ...q, replyPhase: "in_flight" } : q)),
    );
  }, [props.enabled, props.isBusy, active?.id, active?.replyPhase]);

  // After the twin finishes, compare IST vs SOLL.
  // Also fire when the latest user message matches the active exam question
  // (covers cases where pending_send → in_flight was missed).
  useEffect(() => {
    if (!props.enabled || props.isBusy || checking) return;
    if (!active || active.verdict || active.aiSuggestion) return;
    const answer = props.lastAssistantContent?.trim();
    if (!answer) return;

    const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const userMsg = props.lastUserContent?.trim() ?? "";
    const questionMatched =
      Boolean(userMsg) && normalize(userMsg) === normalize(active.question);
    const phaseReady =
      active.replyPhase === "in_flight" ||
      (active.replyPhase === "checked" && !active.aiSuggestion && !active.aiError);

    if (!questionMatched && !phaseReady) return;

    void runAiCheck(active, answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.enabled,
    props.isBusy,
    props.lastAssistantContent,
    props.lastUserContent,
    active?.id,
    active?.replyPhase,
    active?.verdict,
    active?.aiSuggestion,
    active?.aiError,
    active?.question,
    checking,
  ]);

  if (!props.enabled) return null;

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-l border-sbkm-navy/10 bg-gradient-to-b from-white/80 via-white/65 to-sbkm-mint/[0.06] backdrop-blur-md dark:border-white/10 dark:from-sbkm-ink-900/80 dark:via-sbkm-ink-900/55 dark:to-sbkm-mint/[0.04]",
        expanded ? "w-[min(100%,26rem)] sm:w-[28rem] lg:w-[30rem]" : "w-12",
        props.className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-sbkm-navy/10 px-3 py-3 dark:border-white/10">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Prüfleiste einklappen" : "Prüfleiste ausklappen"}
          onClick={() => setExpanded((v) => !v)}
          className="inline-grid size-9 place-items-center rounded-pill text-sbkm-navy transition hover:bg-sbkm-navy/8 dark:text-white dark:hover:bg-white/10"
        >
          {expanded ? (
            <PanelRightClose className="size-4" aria-hidden />
          ) : (
            <PanelRightOpen className="size-4" aria-hidden />
          )}
        </button>
        {expanded ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
              <ClipboardCheck className="mr-1.5 inline size-4 align-[-3px] text-sbkm-mint" aria-hidden />
              {title}
            </p>
            {!loading && questions.length > 0 ? (
              <p className="truncate text-xs text-sbkm-ink-500 dark:text-white/55">
                {openQuestions.length}/{questions.length} offen
                {passCount ? ` · ${passCount} ok` : ""}
                {failCount ? ` · ${failCount} abweichend` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="rail-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 scrollbar-subtle"
          >
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-sbkm-ink-500 dark:text-white/55">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Fragen werden vorbereitet …
              </p>
            ) : error && questions.length === 0 ? (
              <p className="text-sm text-sbkm-ink-500 dark:text-white/55">{error}</p>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
                  „Nächste Frage“ sendet direkt. Unter SOLL erscheint danach groß{" "}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">Stimmt</span>{" "}
                  oder{" "}
                  <span className="font-semibold text-red-700 dark:text-red-300">Stimmt nicht</span>
                  — du bestätigst das Ergebnis.
                </p>

                {nextQuestion ? (
                  <button
                    type="button"
                    disabled={props.isBusy || props.disabled}
                    onClick={() => pick(nextQuestion)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-pill bg-sbkm-navy px-4 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(46,46,80,0.18)] transition hover:bg-sbkm-navy/90 disabled:opacity-50 dark:bg-sbkm-mint dark:text-sbkm-navy"
                  >
                    Nächste Frage
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                ) : questions.length > 0 ? (
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-sbkm-mint">
                    <Check className="size-4" aria-hidden />
                    Alle Fragen gestellt
                  </p>
                ) : null}

                {active ? (
                  <div className="grid gap-3 rounded-2xl border border-sbkm-navy/10 bg-white/85 p-4 shadow-[0_8px_24px_rgba(46,46,80,0.06)] dark:border-white/10 dark:bg-white/[0.05]">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-sbkm-ink-500 dark:text-white/45">
                        Aktuelle Prüffrage
                      </p>
                      <p className="mt-1.5 text-sm font-semibold leading-snug text-sbkm-navy dark:text-white">
                        {active.question}
                      </p>
                    </div>

                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.12] p-3 dark:border-amber-400/25 dark:bg-amber-500/10">
                      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-900/75 dark:text-amber-100/75">
                        SOLL aus Fragebogen
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-amber-950 dark:text-amber-50">
                        {active.expectedHint}
                      </p>
                    </div>

                    {/* Prominent AI verdict directly under SOLL */}
                    {checking ||
                    active.replyPhase === "in_flight" ||
                    (active.replyPhase === "pending_send" && props.isBusy) ? (
                      <div className="flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-950 dark:text-sky-100">
                        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                        {props.isBusy || active.replyPhase === "pending_send"
                          ? "Twin antwortet …"
                          : "KI prüft Antwort gegen SOLL …"}
                      </div>
                    ) : active.aiSuggestion ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className={cn(
                          "rounded-xl border-2 px-4 py-4",
                          active.aiSuggestion.suggested === "pass"
                            ? "border-emerald-500/50 bg-emerald-500/15"
                            : "border-red-500/50 bg-red-500/15",
                        )}
                      >
                        <p
                          className={cn(
                            "text-xl font-bold tracking-tight",
                            active.aiSuggestion.suggested === "pass"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-red-700 dark:text-red-300",
                          )}
                        >
                          {active.aiSuggestion.suggested === "pass" ? (
                            <span className="inline-flex items-center gap-2">
                              <Check className="size-6" aria-hidden />
                              Stimmt
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <X className="size-6" aria-hidden />
                              Stimmt nicht
                            </span>
                          )}
                        </p>
                        <p
                          className={cn(
                            "mt-2 text-sm leading-relaxed",
                            active.aiSuggestion.suggested === "pass"
                              ? "text-emerald-900/85 dark:text-emerald-100/90"
                              : "text-red-900/85 dark:text-red-100/90",
                          )}
                        >
                          {active.aiSuggestion.reason}
                        </p>
                        <p className="mt-2 text-[11px] text-sbkm-ink-500 dark:text-white/50">
                          KI-Vorschlag
                          {active.aiSuggestion.confidence === "high"
                            ? " · hohe Sicherheit"
                            : active.aiSuggestion.confidence === "low"
                              ? " · unsicher"
                              : ""}{" "}
                          — bitte unten bestätigen.
                        </p>
                      </div>
                    ) : active.aiError ? (
                      <div className="rounded-xl border border-sbkm-navy/10 bg-white/70 px-3 py-3 dark:border-white/10 dark:bg-white/5">
                        <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                          Prüfung fehlgeschlagen
                        </p>
                        <p className="mt-1 text-xs text-sbkm-ink-500 dark:text-white/55">
                          {active.aiError}
                        </p>
                        {props.lastAssistantContent?.trim() ? (
                          <button
                            type="button"
                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-white"
                            onClick={() =>
                              void runAiCheck(active, props.lastAssistantContent!.trim(), true)
                            }
                          >
                            <RefreshCw className="size-3.5" aria-hidden />
                            Erneut prüfen
                          </button>
                        ) : null}
                      </div>
                    ) : active.replyPhase === "pending_send" ? (
                      <p className="rounded-xl border border-dashed border-sbkm-navy/15 px-3 py-3 text-sm text-sbkm-ink-500 dark:border-white/15 dark:text-white/55">
                        Frage wird gesendet — danach kommt der KI-Check.
                      </p>
                    ) : (
                      <div className="rounded-xl border border-dashed border-sbkm-navy/15 px-3 py-3 dark:border-white/15">
                        <p className="text-sm text-sbkm-ink-500 dark:text-white/55">
                          Noch kein KI-Ergebnis.
                        </p>
                        {props.lastAssistantContent?.trim() ? (
                          <button
                            type="button"
                            disabled={checking}
                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline disabled:opacity-50 dark:text-white"
                            onClick={() =>
                              void runAiCheck(active, props.lastAssistantContent!.trim(), true)
                            }
                          >
                            <RefreshCw className="size-3.5" aria-hidden />
                            Jetzt prüfen
                          </button>
                        ) : null}
                      </div>
                    )}

                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-sbkm-ink-500 dark:text-white/45">
                        Deine Entscheidung
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setVerdict(active.id, "pass")}
                          className={cn(
                            "inline-flex h-11 items-center justify-center gap-1.5 rounded-pill border text-sm font-semibold transition",
                            active.verdict === "pass"
                              ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-900 dark:text-emerald-100"
                              : "border-sbkm-navy/15 bg-white/80 text-sbkm-navy hover:border-emerald-500/40 hover:bg-emerald-500/10 dark:border-white/15 dark:bg-white/5 dark:text-white",
                          )}
                        >
                          <Check className="size-4" aria-hidden />
                          Stimmt
                        </button>
                        <button
                          type="button"
                          onClick={() => setVerdict(active.id, "fail")}
                          className={cn(
                            "inline-flex h-11 items-center justify-center gap-1.5 rounded-pill border text-sm font-semibold transition",
                            active.verdict === "fail"
                              ? "border-red-500/50 bg-red-500/20 text-red-900 dark:text-red-100"
                              : "border-sbkm-navy/15 bg-white/80 text-sbkm-navy hover:border-red-500/40 hover:bg-red-500/10 dark:border-white/15 dark:bg-white/5 dark:text-white",
                          )}
                        >
                          <X className="size-4" aria-hidden />
                          Weicht ab
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-sbkm-navy/15 px-4 py-8 text-center text-sm text-sbkm-ink-500 dark:border-white/15 dark:text-white/50">
                    Noch keine Frage gestellt — „Nächste Frage“ startet den Check.
                  </div>
                )}

                {openQuestions.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-sbkm-ink-500 dark:text-white/45">
                      Offene Fragen
                    </p>
                    {openQuestions.slice(0, 8).map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        disabled={props.isBusy || props.disabled}
                        onClick={() => pick(q)}
                        className="rounded-xl border border-sbkm-navy/10 bg-white/75 px-3 py-2.5 text-left text-xs font-medium leading-snug text-sbkm-navy transition hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
                      >
                        {q.question}
                      </button>
                    ))}
                  </div>
                ) : null}

                {asked.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-sbkm-ink-500 dark:text-white/45">
                      Gestellt
                    </p>
                    {asked
                      .slice()
                      .reverse()
                      .map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setActiveId(q.id)}
                          className={cn(
                            "rounded-xl border px-3 py-2.5 text-left text-xs leading-snug transition",
                            q.id === active?.id
                              ? "border-sbkm-mint/45 bg-sbkm-mint/10"
                              : "border-sbkm-navy/10 bg-white/55 hover:bg-white/85 dark:border-white/10 dark:bg-white/[0.03]",
                          )}
                        >
                          <span className="line-clamp-2 font-medium text-sbkm-navy dark:text-white">
                            {q.question}
                          </span>
                          <span
                            className={cn(
                              "mt-1 block text-[11px] font-semibold",
                              q.verdict === "pass" || q.aiSuggestion?.suggested === "pass"
                                ? "text-emerald-700 dark:text-emerald-300"
                                : q.verdict === "fail" || q.aiSuggestion?.suggested === "fail"
                                  ? "text-red-700 dark:text-red-300"
                                  : "text-sbkm-ink-500 dark:text-white/45",
                            )}
                          >
                            {q.verdict === "pass"
                              ? "✓ Von dir: Stimmt"
                              : q.verdict === "fail"
                                ? "✗ Von dir: Weicht ab"
                                : q.aiSuggestion
                                  ? q.aiSuggestion.suggested === "pass"
                                    ? "KI: Stimmt — bitte bestätigen"
                                    : "KI: Stimmt nicht — bitte bestätigen"
                                  : "Noch nicht bewertet"}
                          </span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
