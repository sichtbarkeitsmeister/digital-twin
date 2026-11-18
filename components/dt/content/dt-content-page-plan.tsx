"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Save } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { SEITENKONZEPT_FIELDS, THEMENPLAN_MAX, THEMENPLAN_MIN, type ContentSeitenkonzept, type ContentThema } from "@/lib/dt/content/pipeline/page-plan";
import type { ContentReview } from "@/lib/dt/content/types";

const fieldClass =
  "w-full resize-y rounded-dt border border-sbkm-navy/15 bg-white/80 px-2.5 py-2 text-xs leading-relaxed text-sbkm-navy outline-none transition duration-150 focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white";

const titleClass = "flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55";

/** One topic per line: „Thema – was die Seite dazu sagt“. */
export function themenplanToText(plan: readonly ContentThema[]): string {
  return plan.map((t) => (t.inhalt ? `${t.thema} – ${t.inhalt}` : t.thema)).join("\n");
}

/**
 * The lines of the field back into topics. A topic that keeps its name keeps its source („Excel“,
 * „Analyse“); a new or renamed one is the editors' („Redaktion“).
 */
export function themenplanFromText(text: string, before: readonly ContentThema[]): ContentThema[] {
  const known = new Map(before.map((t) => [t.thema.trim().toLowerCase(), t.quelle]));
  const out: ContentThema[] = [];
  for (const line of text.split("\n")) {
    const clean = line.replace(/^\s*(?:[-–•*·]|\d{1,2}[.)])\s*/, "").trim();
    if (!clean) continue;
    const cut = clean.search(/\s[–—-]\s|:\s/);
    const thema = (cut > 0 ? clean.slice(0, cut) : clean).trim();
    const inhalt = cut > 0 ? clean.slice(cut).replace(/^\s*[–—:-]\s*/, "").trim() : "";
    if (thema) out.push({ thema, inhalt, quelle: known.get(thema.toLowerCase()) ?? "Redaktion" });
  }
  return out;
}

/**
 * „Seitenkonzept und Themenplan“ in the page window: what the Analyse decided about this page,
 * readable at a glance and changeable before (or after) the text is written.
 */
export function DtContentPagePlan(props: {
  plan: ContentReview["page_plan"];
  busy: boolean;
  onSave: (plan: { seitenkonzept: ContentSeitenkonzept; themenplan: ContentThema[] }) => Promise<boolean>;
}) {
  const { plan } = props;
  const [editing, setEditing] = useState(false);
  const [konzept, setKonzept] = useState<ContentSeitenkonzept | null>(null);
  const [themen, setThemen] = useState("");

  // A new review (another page, a saved change, a finished Analyse) closes the form.
  const planKey = JSON.stringify([plan.seitenkonzept, plan.themenplan]);
  useEffect(() => {
    setEditing(false);
  }, [planKey]);

  function startEdit() {
    const empty = Object.fromEntries(SEITENKONZEPT_FIELDS.map((f) => [f.key, ""])) as ContentSeitenkonzept;
    setKonzept({ ...empty, ...(plan.seitenkonzept ?? {}) });
    setThemen(themenplanToText(plan.themenplan));
    setEditing(true);
  }

  const topics = editing ? themenplanFromText(themen, plan.themenplan) : plan.themenplan;
  const tooMany = topics.length > THEMENPLAN_MAX;

  return (
    <section className="grid gap-2.5 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
      <h3 className={titleClass}>
        Seitenkonzept und Themenplan
        {plan.edited ? <span className="font-semibold normal-case tracking-normal">von der Redaktion bearbeitet</span> : null}
      </h3>

      {plan.waiting ? (
        <p className="rounded-lg border border-orange-300/70 bg-orange-50 px-2.5 py-1.5 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
          Die Seite hält nach der Analyse. Konzept und Themen prüfen, bei Bedarf ändern, dann oben „Freigeben“: erst danach schreibt der SEO-Schritt.
        </p>
      ) : null}

      {!plan.analysed ? (
        <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">Entsteht in Schritt 1 (Analyse): wer genau diese Seite sucht, und die 4–6 Themen, die sie behandelt.</p>
      ) : !plan.available && !editing ? (
        <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
          Die Analyse dieser Seite ist älter und hat noch kein Seitenkonzept. „Zurücksetzen“ lässt sie neu laufen, oder das Konzept hier von Hand eintragen.
        </p>
      ) : null}

      {editing && konzept ? (
        <div className="grid gap-2">
          {SEITENKONZEPT_FIELDS.map((f) => (
            <label key={f.key} className="grid gap-1 text-xs text-sbkm-navy dark:text-white/85">
              <span className="font-semibold">{f.label}</span>
              <textarea
                className={fieldClass}
                rows={2}
                maxLength={600}
                value={konzept[f.key]}
                disabled={props.busy}
                onChange={(event) => setKonzept({ ...konzept, [f.key]: event.target.value })}
              />
            </label>
          ))}
          <label className="grid gap-1 text-xs text-sbkm-navy dark:text-white/85">
            <span className="font-semibold">
              Themenplan ({THEMENPLAN_MIN}–{THEMENPLAN_MAX} Themen, eines je Zeile: Thema – was die Seite dazu sagt)
            </span>
            <textarea className={fieldClass} rows={7} value={themen} disabled={props.busy} onChange={(event) => setThemen(event.target.value)} />
          </label>
          <p className={tooMany ? "text-[11px] font-semibold text-red-700 dark:text-red-300" : "text-[11px] text-sbkm-ink-500 dark:text-white/45"}>
            {topics.length} {topics.length === 1 ? "Thema" : "Themen"}
            {tooMany ? ` – höchstens ${THEMENPLAN_MAX}; bitte kürzen, sonst werden die letzten nicht gespeichert.` : topics.length < THEMENPLAN_MIN ? ` – empfohlen sind ${THEMENPLAN_MIN} bis ${THEMENPLAN_MAX}.` : ""}
          </p>
          {plan.text_written ? (
            <p className="text-[11px] leading-snug text-orange-700 dark:text-orange-300">
              Der Text ist schon geschrieben. Die Änderung gilt für die Schritte, die noch laufen; für einen neuen Text nach diesem Plan die Seite ab SEO wiederholen.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <DtPillButton
              size="sm"
              disabled={props.busy || tooMany}
              onClick={() => void props.onSave({ seitenkonzept: konzept, themenplan: topics }).then((ok) => ok && setEditing(false))}
            >
              {props.busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
              Speichern
            </DtPillButton>
            <DtPillButton size="sm" variant="ghost" disabled={props.busy} onClick={() => setEditing(false)}>
              Abbrechen
            </DtPillButton>
          </div>
        </div>
      ) : plan.available ? (
        <div className="grid gap-2.5">
          {plan.seitenkonzept ? (
            <dl className="grid gap-1.5 text-xs leading-relaxed">
              {SEITENKONZEPT_FIELDS.filter((f) => plan.seitenkonzept![f.key]).map((f) => (
                <div key={f.key}>
                  <dt className="font-semibold text-sbkm-navy dark:text-white">{f.label}</dt>
                  <dd className="text-sbkm-ink-600 dark:text-white/70">{plan.seitenkonzept![f.key]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {plan.themenplan.length > 0 ? (
            <div className="grid gap-1">
              <p className="text-xs font-semibold text-sbkm-navy dark:text-white">Themenplan</p>
              <ol className="grid gap-1 text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/70">
                {plan.themenplan.map((t, i) => (
                  <li key={`${i}-${t.thema}`} className="flex gap-1.5">
                    <span className="w-4 shrink-0 text-right tabular-nums text-sbkm-ink-500 dark:text-white/40">{i + 1}.</span>
                    <span>
                      <span className="font-semibold text-sbkm-navy dark:text-white">{t.thema}</span>
                      {t.inhalt ? ` – ${t.inhalt}` : ""}
                      {t.quelle !== "Analyse" ? <span className="ml-1 rounded-pill bg-sbkm-navy/[0.06] px-1.5 py-px text-[10px] font-semibold dark:bg-white/10">{t.quelle}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {plan.editable && !editing ? (
        <div>
          <DtPillButton size="sm" variant="outline" disabled={props.busy} onClick={startEdit}>
            <Pencil className="size-3.5" aria-hidden />
            {plan.available ? "Bearbeiten" : "Von Hand eintragen"}
          </DtPillButton>
        </div>
      ) : null}
    </section>
  );
}
