"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi } from "@/components/dt/content/content-api";
import type { ContentOrgQuestionsResult, ContentQuestion, ContentReview } from "@/lib/dt/content/types";

const sectionTitleClass =
  "flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-500 dark:text-white/45";
const fieldClass =
  "min-h-[56px] w-full resize-y rounded-dt border border-sbkm-navy/15 bg-white/80 px-3 py-2 text-sm leading-relaxed text-sbkm-navy outline-none placeholder:text-sbkm-ink-500 focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white";

type Decision = { action: "answer" | "drop"; answer: string };

function QuestionHead(props: { q: Pick<ContentQuestion, "question" | "section" | "block_id" | "excerpt">; icon?: "firma" }) {
  return (
    <>
      {props.q.section || props.q.block_id ? (
        <p className="ml-6 text-[11px] font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300">
          Abschnitt „{props.q.section || props.q.block_id}“
        </p>
      ) : null}
      <p className="flex gap-2 text-sm font-medium leading-snug text-sbkm-navy dark:text-white">
        {props.icon === "firma" ? (
          <Building2 className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
        ) : (
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
        )}
        {props.q.question}
      </p>
      {props.q.excerpt ? (
        <blockquote className="ml-6 border-l-2 border-sbkm-navy/15 pl-2.5 text-xs italic text-sbkm-ink-600 dark:border-white/20 dark:text-white/60">
          {props.q.excerpt}
        </blockquote>
      ) : null}
    </>
  );
}

/**
 * „Fragen an den Kunden“ in the page window.
 *   - At the page's one stop before the Watermark Entfernung: an answer field per question and
 *     „Ohne Angabe weiter“ (the sentence goes); company questions answer through „Fragen zum
 *     Unternehmen“ (one answer for all pages); when all are handled, „Antworten einarbeiten &
 *     weiter“.
 *   - After the Faktencheck for the one „grundlegend“ question: its answer and „weiter“.
 *   - While the page runs: what has been collected, asked once before the Watermark Entfernung.
 *   - Pages that stopped under the old rules: the list as before; „Freigeben“ and „Abschnitt
 *     ändern“ stay where they were.
 */
export function DtContentQuestionsPanel(props: {
  organisationId: string;
  pageBase: string;
  review: ContentReview;
  disabled: boolean;
  onReview: (review: ContentReview, jobId: string | null) => void;
}) {
  const { review } = props;
  const waiting = review.public.state === "braucht_sie" && review.question_stop.status === "waiting";
  const grundlegend = review.public.state === "braucht_sie" ? review.questions.find((q) => q.grundlegend) ?? null : null;
  const pageQuestions = useMemo(() => (grundlegend ? [grundlegend] : review.questions), [grundlegend, review.questions]);
  const openCompany = waiting ? review.org_questions.filter((q) => q.status === "open") : [];
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [companyAnswers, setCompanyAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, Decision> = {};
    for (const h of review.question_stop.handled) {
      if (h.source === "kunde") next[h.id] = { action: h.action, answer: h.answer ?? "" };
    }
    setDecisions(next);
  }, [review.question_stop.handled]);

  const allDecided = useMemo(
    () => pageQuestions.every((q) => q.id && (decisions[q.id]?.action === "drop" || decisions[q.id]?.answer.trim())),
    [pageQuestions, decisions],
  );
  const canSubmit = (waiting || Boolean(grundlegend)) && allDecided && openCompany.length === 0;

  async function submit() {
    setBusy("submit");
    const res = await contentApi<{ job_id: string | null; review: ContentReview }>(`${props.pageBase}/answers`, {
      method: "POST",
      body: {
        organisationId: props.organisationId,
        submit: true,
        answers: pageQuestions
          .filter((q) => q.id && decisions[q.id])
          .map((q) => ({ id: q.id!, action: decisions[q.id!]!.action, answer: decisions[q.id!]!.action === "answer" ? decisions[q.id!]!.answer : null })),
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(grundlegend ? "Antwort übernommen – läuft weiter" : "Antworten werden eingearbeitet – läuft weiter");
    props.onReview(res.data.review, res.data.job_id);
  }

  async function answerCompany(id: string, action: "answer" | "no_answer") {
    setBusy(id);
    const res = await contentApi<ContentOrgQuestionsResult>("/api/dt/content/org-questions", {
      method: "PUT",
      body: { organisationId: props.organisationId, id, action, answer: action === "answer" ? companyAnswers[id] ?? "" : null },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(action === "answer" ? "Antwort gespeichert – gilt für alle Seiten" : "„Keine Angabe“ gespeichert");
    const byId = new Map(res.data.questions.map((q) => [q.id, q]));
    props.onReview(
      { ...review, org_questions: review.org_questions.map((q) => (byId.get(q.id) ? { ...q, status: byId.get(q.id)!.status, answer: byId.get(q.id)!.answer } : q)) },
      null,
    );
  }

  const collected = review.collected_questions;
  const count = waiting ? pageQuestions.length + openCompany.length : review.public.state === "braucht_sie" ? review.questions.length : collected.length;

  return (
    <section className="grid gap-2.5 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
      <h3 className={sectionTitleClass}>
        Fragen an den Kunden
        <span className="tabular-nums">{count}</span>
      </h3>

      {waiting || grundlegend ? (
        <>
          <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
            {grundlegend
              ? "Der Faktencheck zweifelt am Hauptthema dieser Seite. Die Antwort gilt für alle weiteren Schritte; die übrigen Fragen kommen gesammelt vor der Watermark Entfernung."
              : "Einmal beantworten, dann geht es weiter. „Ohne Angabe weiter“ streicht den Satz mit dieser Stelle."}
          </p>
          <ul className="grid gap-3">
            {pageQuestions.map((q) => {
              const id = q.id ?? q.question;
              const d = decisions[id];
              return (
                <li key={id} className="grid gap-1.5">
                  <QuestionHead q={q} />
                  <textarea
                    className={cn(fieldClass, "ml-6 w-[calc(100%-1.5rem)]", d?.action === "drop" && "opacity-50")}
                    value={d?.action === "answer" ? d.answer : ""}
                    disabled={props.disabled || busy != null || d?.action === "drop"}
                    placeholder={d?.action === "drop" ? "Ohne Angabe – der Satz wird gestrichen" : "Antwort des Kunden"}
                    onChange={(e) => setDecisions((prev) => ({ ...prev, [id]: { action: "answer", answer: e.target.value } }))}
                    aria-label={`Antwort: ${q.question}`}
                  />
                  <label className="ml-6 flex w-fit items-center gap-2 text-xs text-sbkm-navy dark:text-white/80">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-sbkm-navy"
                      checked={d?.action === "drop"}
                      disabled={props.disabled || busy != null}
                      onChange={(e) =>
                        setDecisions((prev) => ({ ...prev, [id]: e.target.checked ? { action: "drop", answer: "" } : { action: "answer", answer: "" } }))
                      }
                    />
                    Ohne Angabe weiter
                  </label>
                </li>
              );
            })}
            {openCompany.map((q) => (
              <li key={q.id} className="grid gap-1.5 rounded-xl border border-orange-200/70 bg-orange-50/50 p-2.5 dark:border-orange-400/20 dark:bg-orange-500/5">
                <QuestionHead q={{ question: q.question, section: null, block_id: null, excerpt: null }} icon="firma" />
                <p className="ml-6 text-[11px] text-sbkm-ink-500 dark:text-white/45">
                  Frage zum Unternehmen{q.pages > 1 ? ` (von ${q.pages} Seiten)` : ""} – die Antwort gilt für alle Seiten.
                </p>
                <textarea
                  className={cn(fieldClass, "ml-6 w-[calc(100%-1.5rem)]")}
                  value={companyAnswers[q.id] ?? ""}
                  disabled={props.disabled || busy != null}
                  placeholder={q.placeholder ?? "Antwort des Kunden"}
                  onChange={(e) => setCompanyAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  aria-label={`Antwort: ${q.question}`}
                />
                <div className="ml-6 flex flex-wrap gap-2">
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    disabled={props.disabled || busy != null || !(companyAnswers[q.id] ?? "").trim()}
                    onClick={() => void answerCompany(q.id, "answer")}
                  >
                    {busy === q.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3" aria-hidden />}
                    Antwort speichern
                  </DtPillButton>
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-3 text-xs"
                    disabled={props.disabled || busy != null}
                    onClick={() => void answerCompany(q.id, "no_answer")}
                  >
                    Keine Angabe
                  </DtPillButton>
                </div>
              </li>
            ))}
          </ul>
          <DtPillButton type="button" size="sm" disabled={props.disabled || busy != null || !canSubmit} onClick={() => void submit()} className="w-fit">
            {busy === "submit" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
            {grundlegend ? "Antwort übernehmen & weiter" : "Antworten einarbeiten & weiter"}
          </DtPillButton>
          {!canSubmit ? (
            <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
              {openCompany.length > 0
                ? "Erst die Fragen zum Unternehmen beantworten oder „Keine Angabe“ wählen."
                : "Jede Frage beantworten oder „Ohne Angabe weiter“ wählen."}
            </p>
          ) : null}
        </>
      ) : review.public.state === "braucht_sie" && review.questions.length > 0 ? (
        // Stopped under the old rules: the list as before.
        <ul className="grid gap-2.5">
          {review.questions.map((q, i) => (
            <li key={`${q.question}-${i}`} className="grid gap-1.5">
              <QuestionHead q={q} />
              {q.blocking ? (
                <p className="ml-6 inline-flex items-center gap-1 text-[11px] font-semibold text-orange-700 dark:text-orange-300">
                  <AlertTriangle className="size-3" aria-hidden />
                  Muss vor dem Weiterlaufen geklärt werden
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : collected.length > 0 ? (
        <>
          <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
            Gesammelt – die Seite fragt einmal, vor der Watermark Entfernung.
          </p>
          <ul className="grid gap-2">
            {collected.map((q, i) => (
              <li key={`${q.id ?? q.question}-${i}`} className="grid gap-1">
                <QuestionHead q={q} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
          {review.question_stop.status === "done"
            ? `Keine Fragen offen.${review.question_stop.pass_cost ? ` Antworten eingearbeitet (${review.question_stop.pass_cost}).` : ""}`
            : "Keine Fragen offen."}
        </p>
      )}
    </section>
  );
}
