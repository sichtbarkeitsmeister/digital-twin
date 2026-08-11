"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ClipboardList, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import type { SurveyExamQuestion } from "@/lib/dt/survey-exam-questions";

export function DtPersonaTestingPanel(props: {
  agentId: string;
  enabled: boolean;
  isBusy?: boolean;
  disabled?: boolean;
  onPickQuestion: (question: string, expectedHint: string) => void;
}) {
  const [questions, setQuestions] = useState<SurveyExamQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(true);
  const [activeHint, setActiveHint] = useState<string | null>(null);

  useEffect(() => {
    if (!props.enabled) {
      setQuestions([]);
      setError(null);
      setSentIds(new Set());
      setActiveHint(null);
      setOpen(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSentIds(new Set());
    setActiveHint(null);
    setOpen(true);

    void (async () => {
      try {
        const res = await fetch(`/api/dt/agents/${props.agentId}/exam-questions`);
        const json = (await res.json()) as {
          ok?: boolean;
          available?: boolean;
          questions?: SurveyExamQuestion[];
          message?: string;
        };
        if (cancelled) return;
        if (!json.ok) {
          setQuestions([]);
          setError(json.message ?? "Prüfungsfragen konnten nicht geladen werden.");
          return;
        }
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

  const openQuestions = useMemo(
    () => questions.filter((q) => !sentIds.has(q.id)),
    [questions, sentIds],
  );

  const nextQuestion = openQuestions[0] ?? null;

  function pick(q: SurveyExamQuestion) {
    if (props.isBusy || props.disabled) return;
    props.onPickQuestion(q.question, q.expectedHint);
    setActiveHint(q.expectedHint);
    setSentIds((prev) => new Set(prev).add(q.id));
  }

  if (!props.enabled) return null;

  return (
    <div className="mb-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="dt-composer-persona-testing"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill border px-2.5 text-left transition duration-150 active:scale-[0.98]",
            open
              ? "border-sbkm-mint/45 bg-sbkm-mint/10 dark:border-sbkm-mint/30 dark:bg-sbkm-mint/10"
              : "border-sbkm-navy/12 bg-white/80 hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 dark:border-white/12 dark:bg-white/5 dark:hover:bg-white/10",
          )}
        >
          <ClipboardList className="h-3.5 w-3.5 shrink-0 text-sbkm-navy dark:text-white" aria-hidden />
          <span className="truncate text-xs font-semibold text-sbkm-navy dark:text-white">
            Prüfungsfragen
            {!loading && questions.length > 0 ? (
              <span className="font-medium text-sbkm-ink-500 dark:text-white/50">
                {" "}
                · {openQuestions.length}/{questions.length} offen
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-sbkm-ink-500 transition-transform duration-200 dark:text-white/60",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {nextQuestion && !loading ? (
          <button
            type="button"
            disabled={props.isBusy || props.disabled}
            onClick={() => pick(nextQuestion)}
            className="inline-flex h-8 items-center rounded-pill border border-sbkm-navy/15 bg-sbkm-navy px-2.5 text-xs font-semibold text-white transition hover:bg-sbkm-navy/90 disabled:opacity-50 dark:bg-sbkm-mint dark:text-sbkm-navy"
          >
            Nächste Frage
          </button>
        ) : null}

        {!loading && questions.length > 0 && openQuestions.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-sbkm-mint">
            <Check className="size-3.5" aria-hidden />
            Alle Fragen gestellt
          </span>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="dt-composer-persona-testing"
            key="persona-testing"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {loading ? (
              <p className="flex items-center gap-2 pt-1 text-xs text-sbkm-ink-500 dark:text-white/55">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Fragen werden vorbereitet …
              </p>
            ) : error && questions.length === 0 ? (
              <p className="pt-1 text-xs text-sbkm-ink-500 dark:text-white/55">{error}</p>
            ) : openQuestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {openQuestions.slice(0, 8).map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={props.isBusy || props.disabled}
                    title={q.expectedHint}
                    onClick={() => pick(q)}
                    className="max-w-full rounded-pill border border-sbkm-navy/12 bg-white/75 px-2.5 py-1 text-left text-[11px] font-semibold leading-snug text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition duration-150 hover:-translate-y-px hover:border-sbkm-mint/40 hover:bg-sbkm-mint/12 active:scale-[0.98] disabled:opacity-50 dark:border-white/12 dark:bg-white/5 dark:text-white"
                  >
                    <span className="line-clamp-2">{q.question}</span>
                  </button>
                ))}
                {openQuestions.length > 8 ? (
                  <span className="self-center text-[11px] text-sbkm-ink-500 dark:text-white/50">
                    +{openQuestions.length - 8} weitere über „Nächste Frage“
                  </span>
                ) : null}
              </div>
            ) : null}

            {activeHint && !props.isBusy ? (
              <p className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950 dark:text-amber-100">
                <span className="font-semibold">Erwartung aus Fragebogen:</span> {activeHint}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
