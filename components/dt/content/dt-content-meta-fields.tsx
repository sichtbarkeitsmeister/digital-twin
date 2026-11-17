"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { cn } from "@/components/dt/cn";

/** What the SEO step aims for: a longer Title or Meta-Description is cut off in the search result. */
export const TITLE_TARGET_MAX = 60;
export const META_TARGET_MAX = 155;

const fieldClass =
  "w-full rounded-dt border bg-white/80 px-2.5 py-1.5 text-sm leading-snug text-sbkm-navy outline-none transition placeholder:text-sbkm-ink-500/70 hover:border-sbkm-navy/25 focus-visible:border-sbkm-mint/50 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-60 dark:bg-white/10 dark:text-white";

type Field = "title" | "meta_description";

/**
 * Title-Tag and Meta-Description of the page, above its text: both are written by the SEO step and
 * checked by the later ones, but are not part of the text, so they were not shown anywhere. With
 * `editable` the person clicks in and types; leaving the field saves it, Esc takes the change back.
 * The counter turns amber over the length a search result shows (60 and 155 characters).
 */
export function DtContentMetaFields(props: {
  title: string | null;
  metaDescription: string | null;
  editable: boolean;
  /** Saves one field; resolves with whether it was saved. */
  onSave: (field: Field, value: string) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({});
  // The ref is the truth for the blur that follows Esc: React has not rendered the taken-back draft by then.
  const draftsRef = useRef<Partial<Record<Field, string>>>({});
  const setDraft = (field: Field, text: string | null) => {
    const next = { ...draftsRef.current };
    if (text === null) delete next[field];
    else next[field] = text;
    draftsRef.current = next;
    setDrafts(next);
  };
  const [saving, setSaving] = useState<Field | null>(null);
  const [focused, setFocused] = useState<Field | null>(null);

  const stored: Record<Field, string> = { title: props.title ?? "", meta_description: props.metaDescription ?? "" };
  const value = (field: Field) => drafts[field] ?? stored[field];
  const dirty = (field: Field) => drafts[field] !== undefined && drafts[field]!.replace(/\s+/g, " ").trim() !== stored[field];

  function revert(field: Field) {
    setDraft(field, null);
  }

  async function commit(field: Field) {
    const sent = draftsRef.current[field];
    if (sent === undefined) return;
    if (sent.replace(/\s+/g, " ").trim() === stored[field]) {
      revert(field);
      return;
    }
    if (saving) return;
    setSaving(field);
    const ok = await props.onSave(field, sent);
    setSaving(null);
    // Saved: the page brings the new value; refused: the draft stays, marked, for another try.
    if (ok) revert(field);
  }

  const rows: Array<{ field: Field; label: string; hint: string; max: number; multiline: boolean; placeholder: string }> = [
    { field: "title", label: "Title-Tag", hint: "Überschrift im Suchergebnis", max: TITLE_TARGET_MAX, multiline: false, placeholder: "Noch kein Title-Tag" },
    { field: "meta_description", label: "Meta-Description", hint: "Beschreibung im Suchergebnis", max: META_TARGET_MAX, multiline: true, placeholder: "Noch keine Meta-Description" },
  ];

  return (
    <section
      aria-label="Title und Meta-Description"
      className="grid gap-3 rounded-dt border border-sbkm-navy/10 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/50">Für das Suchergebnis</h3>
        <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
          {props.editable ? "Direkt anklicken und ändern, gespeichert wird beim Verlassen des Feldes (Esc nimmt zurück)." : "Gehört zum Text, steht aber nicht in den Abschnitten."}
        </p>
      </div>
      {rows.map((row) => {
        const text = value(row.field);
        const length = text.replace(/\s+/g, " ").trim().length;
        const over = length > row.max;
        // A change left behind: the field was left (or refused) and it is still different from what is stored.
        const failed = dirty(row.field) && saving === null && focused !== row.field;
        const common = {
          value: text,
          disabled: !props.editable || saving === row.field,
          placeholder: props.editable ? row.placeholder : "–",
          id: `content-meta-${row.field}`,
          onChange: (e: { target: { value: string } }) => setDraft(row.field, e.target.value),
          onFocus: () => setFocused(row.field),
          onBlur: () => {
            setFocused(null);
            void commit(row.field);
          },
          className: cn(fieldClass, failed ? "border-amber-400/80" : "border-sbkm-navy/12 dark:border-white/15", !props.editable && "cursor-default border-transparent bg-transparent px-0"),
        };
        return (
          <div key={row.field} className="grid gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`content-meta-${row.field}`} className="text-xs font-semibold text-sbkm-navy dark:text-white">
                {row.label} <span className="font-normal text-sbkm-ink-500 dark:text-white/45">· {row.hint}</span>
              </label>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] tabular-nums",
                  over ? "font-semibold text-amber-700 dark:text-amber-300" : "text-sbkm-ink-500 dark:text-white/45",
                )}
                title={over ? "Länger als im Suchergebnis angezeigt wird" : undefined}
              >
                {saving === row.field ? <Loader2 className="size-3 animate-spin" aria-hidden /> : over ? <AlertTriangle className="size-3" aria-hidden /> : null}
                {length}/{row.max} Zeichen
              </span>
            </div>
            {row.multiline ? (
              <textarea
                {...common}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    revert(row.field);
                    e.currentTarget.blur();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <input
                type="text"
                {...common}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    revert(row.field);
                    e.currentTarget.blur();
                  } else if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            )}
            {failed ? <p className="text-[11px] text-amber-700 dark:text-amber-300">Noch nicht gespeichert (Feld verlassen) – oder abgelehnt, dann bitte erneut versuchen.</p> : null}
          </div>
        );
      })}
    </section>
  );
}
