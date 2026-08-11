"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  ClipboardList,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import type {
  SurveyExamAudience,
  SurveyExamQuestion,
} from "@/lib/dt/survey-exam-questions";

export type PersonaExamVerdict = "pass" | "fail" | null;

type AskedExam = SurveyExamQuestion & {
  verdict: PersonaExamVerdict;
};

/**
 * Collapsible testing rail beside the chat: question bank + expected
 * questionnaire answer so you can judge whether the twin matched the fact.
 */
export function DtPersonaTestingRail(props: {
  agentId: string;
  enabled: boolean;
  isBusy?: boolean;
  disabled?: boolean;
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

  useEffect(() => {
    if (!props.enabled) {
      setQuestions([]);
      setAudience("persona");
      setError(null);
      setAsked([]);
      setActiveId(null);
      setExpanded(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAsked([]);
    setActiveId(null);
    setExpanded(true);

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
  const title = audience === "company" ? "Firmen-Check" : "Persona-Check";

  function pick(q: SurveyExamQuestion) {
    if (props.isBusy || props.disabled) return;
    props.onPickQuestion(q.question);
    setAsked((prev) => {
      if (prev.some((p) => p.id === q.id)) return prev;
      return [...prev, { ...q, verdict: null }];
    });
    setActiveId(q.id);
    setExpanded(true);
  }

  function setVerdict(id: string, verdict: Exclude<PersonaExamVerdict, null>) {
    setAsked((prev) => prev.map((q) => (q.id === id ? { ...q, verdict } : q)));
  }

  if (!props.enabled) return null;

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-l border-sbkm-navy/10 bg-white/55 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.03]",
        expanded ? "w-[min(100%,20rem)] sm:w-[22rem]" : "w-11",
        props.className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-sbkm-navy/10 px-2 py-2 dark:border-white/10">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Prüfleiste einklappen" : "Prüfleiste ausklappen"}
          onClick={() => setExpanded((v) => !v)}
          className="inline-grid size-8 place-items-center rounded-pill text-sbkm-navy transition hover:bg-sbkm-navy/8 dark:text-white dark:hover:bg-white/10"
        >
          {expanded ? (
            <PanelRightClose className="size-4" aria-hidden />
          ) : (
            <PanelRightOpen className="size-4" aria-hidden />
          )}
        </button>
        {expanded ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sbkm-navy dark:text-white">
              <ClipboardList className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              {title}
            </p>
            {!loading && questions.length > 0 ? (
              <p className="truncate text-[11px] text-sbkm-ink-500 dark:text-white/50">
                {openQuestions.length}/{questions.length} offen
                {asked.filter((q) => q.verdict === "pass").length
                  ? ` · ${asked.filter((q) => q.verdict === "pass").length} ok`
                  : ""}
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
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 scrollbar-subtle"
          >
            {loading ? (
              <p className="flex items-center gap-2 text-xs text-sbkm-ink-500 dark:text-white/55">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Fragen werden vorbereitet …
              </p>
            ) : error && questions.length === 0 ? (
              <p className="text-xs text-sbkm-ink-500 dark:text-white/55">{error}</p>
            ) : (
              <>
                <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/55">
                  Stelle eine Frage, lies die Twin-Antwort im Chat — und prüfe hier, ob der
                  Fragebogen-Inhalt wirklich vorkommt.
                </p>

                {nextQuestion ? (
                  <button
                    type="button"
                    disabled={props.isBusy || props.disabled}
                    onClick={() => pick(nextQuestion)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-pill bg-sbkm-navy px-3 text-xs font-semibold text-white transition hover:bg-sbkm-navy/90 disabled:opacity-50 dark:bg-sbkm-mint dark:text-sbkm-navy"
                  >
                    Nächste Frage
                    <ChevronRight className="size-3.5" aria-hidden />
                  </button>
                ) : questions.length > 0 ? (
                  <p className="inline-flex items-center gap-1 text-xs font-medium text-sbkm-mint">
                    <Check className="size-3.5" aria-hidden />
                    Alle Fragen gestellt
                  </p>
                ) : null}

                {active ? (
                  <div className="grid gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 dark:border-amber-400/25 dark:bg-amber-500/10">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900/80 dark:text-amber-100/80">
                      Erwartung aus Fragebogen
                    </p>
                    <p className="text-xs font-semibold leading-snug text-sbkm-navy dark:text-white">
                      {active.question}
                    </p>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-amber-950 dark:text-amber-50">
                      {active.expectedHint}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setVerdict(active.id, "pass")}
                        className={cn(
                          "inline-flex h-8 items-center gap-1 rounded-pill border px-2.5 text-[11px] font-semibold transition",
                          active.verdict === "pass"
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                            : "border-sbkm-navy/15 bg-white/70 text-sbkm-navy hover:border-emerald-500/40 dark:border-white/15 dark:bg-white/5 dark:text-white",
                        )}
                      >
                        <Check className="size-3.5" aria-hidden />
                        Stimmt
                      </button>
                      <button
                        type="button"
                        onClick={() => setVerdict(active.id, "fail")}
                        className={cn(
                          "inline-flex h-8 items-center gap-1 rounded-pill border px-2.5 text-[11px] font-semibold transition",
                          active.verdict === "fail"
                            ? "border-red-500/50 bg-red-500/15 text-red-800 dark:text-red-200"
                            : "border-sbkm-navy/15 bg-white/70 text-sbkm-navy hover:border-red-500/40 dark:border-white/15 dark:bg-white/5 dark:text-white",
                        )}
                      >
                        <X className="size-3.5" aria-hidden />
                        Weicht ab
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-sbkm-navy/15 px-3 py-4 text-center text-[11px] text-sbkm-ink-500 dark:border-white/15 dark:text-white/50">
                    Noch keine Frage gestellt — „Nächste Frage“ startet den Check.
                  </div>
                )}

                {openQuestions.length > 0 ? (
                  <div className="grid gap-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/45">
                      Offene Fragen
                    </p>
                    {openQuestions.slice(0, 10).map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        disabled={props.isBusy || props.disabled}
                        onClick={() => pick(q)}
                        className="rounded-lg border border-sbkm-navy/10 bg-white/70 px-2.5 py-2 text-left text-[11px] font-medium leading-snug text-sbkm-navy transition hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
                      >
                        {q.question}
                      </button>
                    ))}
                  </div>
                ) : null}

                {asked.length > 0 ? (
                  <div className="grid gap-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/45">
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
                            "rounded-lg border px-2.5 py-2 text-left text-[11px] leading-snug transition",
                            q.id === active?.id
                              ? "border-sbkm-mint/45 bg-sbkm-mint/10"
                              : "border-sbkm-navy/10 bg-white/50 hover:bg-white/80 dark:border-white/10 dark:bg-white/[0.03]",
                          )}
                        >
                          <span className="line-clamp-2 font-medium text-sbkm-navy dark:text-white">
                            {q.question}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-sbkm-ink-500 dark:text-white/45">
                            {q.verdict === "pass"
                              ? "✓ Stimmt"
                              : q.verdict === "fail"
                                ? "✗ Weicht ab"
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
