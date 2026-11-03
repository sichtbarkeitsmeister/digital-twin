"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import type { ContentOrgQuestionsResult } from "@/lib/dt/content/types";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";
const fieldClass =
  "min-h-[52px] w-full resize-y rounded-[10px] border border-sbkm-navy/15 bg-white px-3 py-2 text-sm text-sbkm-navy outline-none placeholder:text-sbkm-ink-500 focus:border-sbkm-navy focus:shadow-dt-focus disabled:opacity-60 dark:border-white/15 dark:bg-sbkm-ink-900/80 dark:text-white";

type Question = ContentOrgQuestionsResult["questions"][number];

/**
 * „Fragen zum Unternehmen“ near the Kontaktdaten: questions about the company that pages raised
 * (Telefon, Öffnungszeiten, Google-Profil …), asked once for the organisation instead of on every
 * page. One answer applies to all pages; a contact topic also lands in the Kontaktdaten.
 */
export function DtContentOrgQuestionsCard(props: { organisationId: string; refreshKey?: number }) {
  const { organisationId } = props;
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAnswered, setShowAnswered] = useState(false);

  const load = useCallback(async () => {
    const res = await contentApi<ContentOrgQuestionsResult>(`/api/dt/content/org-questions?${contentQuery(organisationId)}`);
    if (res.ok) {
      setQuestions(res.data.questions);
      setError(null);
    } else {
      setError(res.message);
    }
  }, [organisationId]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  async function act(q: Question, action: "answer" | "no_answer" | "reopen") {
    setBusy(q.id);
    const res = await contentApi<ContentOrgQuestionsResult>("/api/dt/content/org-questions", {
      method: "PUT",
      body: { organisationId, id: q.id, action, answer: action === "answer" ? drafts[q.id] ?? "" : null },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setQuestions(res.data.questions);
    toast.success(
      action === "answer" ? "Antwort gespeichert – gilt für alle Seiten" : action === "no_answer" ? "„Keine Angabe“ gespeichert" : "Wieder offen",
    );
  }

  const open = (questions ?? []).filter((q) => q.status === "open");
  const done = (questions ?? []).filter((q) => q.status !== "open");
  if (!error && questions && questions.length === 0) return null;

  return (
    <section aria-label="Fragen zum Unternehmen" className={cardClass}>
      <header className="flex flex-wrap items-center gap-2 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <Building2 className="size-4 shrink-0 text-sbkm-mint" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Fragen zum Unternehmen</h2>
        <span className="text-xs text-sbkm-ink-600 dark:text-white/60">
          {error ?? (questions ? `${open.length} offen · ${done.length} beantwortet` : "Wird geladen …")}
        </span>
      </header>
      {questions ? (
        <div className="grid gap-3 px-4 py-4 sm:px-5">
          <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
            Angaben, die auf jeder Seite gleich sind, fragt Texte nur einmal. Eine Antwort gilt für alle Seiten; Telefon, Adresse,
            Öffnungszeiten, Google-Profil und Ähnliches landen zusätzlich in den Kontaktdaten. „Keine Angabe“: die Aussage bleibt weg.
          </p>
          {open.length === 0 ? <p className="text-sm text-sbkm-ink-600 dark:text-white/60">Keine Frage offen.</p> : null}
          <ul className="grid gap-3">
            {open.map((q) => (
              <li key={q.id} className="grid gap-1.5">
                <p className="text-sm font-medium leading-snug text-sbkm-navy dark:text-white">{q.question}</p>
                <p className="text-[11px] text-sbkm-ink-500 dark:text-white/45">
                  Gefragt von {q.pages} {q.pages === 1 ? "Seite" : "Seiten"}
                </p>
                <textarea
                  className={fieldClass}
                  value={drafts[q.id] ?? ""}
                  disabled={busy != null}
                  placeholder={q.placeholder ?? "Antwort des Kunden"}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  aria-label={`Antwort: ${q.question}`}
                />
                <div className="flex flex-wrap gap-2">
                  <DtPillButton type="button" size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={busy != null || !(drafts[q.id] ?? "").trim()} onClick={() => void act(q, "answer")}>
                    {busy === q.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                    Antwort speichern
                  </DtPillButton>
                  <DtPillButton type="button" size="sm" variant="ghost" className="h-8 px-3 text-xs" disabled={busy != null} onClick={() => void act(q, "no_answer")}>
                    Keine Angabe
                  </DtPillButton>
                </div>
              </li>
            ))}
          </ul>
          {done.length > 0 ? (
            <div className="grid gap-2 border-t border-sbkm-navy/8 pt-3 dark:border-white/8">
              <button
                type="button"
                onClick={() => setShowAnswered((v) => !v)}
                className="flex w-fit items-center gap-1 text-xs font-semibold text-sbkm-navy dark:text-white/80"
                aria-expanded={showAnswered}
              >
                Beantwortet ({done.length})
                <ChevronDown className={cn("size-3.5 transition-transform", showAnswered && "rotate-180")} aria-hidden />
              </button>
              {showAnswered ? (
                <ul className="grid gap-2">
                  {done.map((q) => (
                    <li key={q.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className="min-w-0">
                        <span className="font-medium text-sbkm-navy dark:text-white">{q.question}</span>
                        <span className="block text-sbkm-ink-600 dark:text-white/60">{q.status === "answered" ? q.answer : "Keine Angabe"}</span>
                      </span>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void act(q, "reopen")}
                        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-sbkm-navy underline-offset-2 hover:underline disabled:opacity-50 dark:text-sbkm-mint"
                      >
                        <RotateCcw className="size-3" aria-hidden />
                        Ändern
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
