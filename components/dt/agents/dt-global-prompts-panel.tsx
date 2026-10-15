"use client";

import Link from "next/link";
import { CheckSquare, ClipboardList, FileText, Globe2, Sparkles } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";
import { textToChecklist } from "@/lib/dt/seo/seo-checklist";

type GlobalPrompts = {
  default: string;
  seo_advisor: string;
  survey_to_agent: string;
  survey_refine_agent: string;
};

const PROMPT_META: Record<
  keyof GlobalPrompts,
  { title: string; description: string; icon: typeof Sparkles; placeholder?: string }
> = {
  default: {
    title: "DigitalTwin",
    description:
      "Globaler Wunschkunden-Prompt (Interessent/Pre-Sale). Avatar-Persönlichkeit liegt im avatar-spezifischen Teil je Agent.",
    icon: Sparkles,
  },
  seo_advisor: {
    title: "SEO-Berater",
    description:
      "Nur im SEO-Modus für Plattform-Admins. Nutzt SEO-Daten, Website-Inhalte, Anbieter-Wissen und automatisch die Wunschkunden-Avatare der jeweiligen Organisation.",
    icon: Globe2,
  },
  survey_to_agent: {
    title: "Umfrage → Agent (Neu)",
    description:
      "Erzeugt den avatar-spezifischen Teil eines Wunschkunden; der Agent nutzt den globalen DigitalTwin-Prompt.",
    icon: ClipboardList,
    placeholder:
      "Prompt für die JSON-Ausgabe (name, role, slug, prompt_template, …). Platzhalter {{reference_examples}} für Referenz-Agenten.",
  },
  survey_refine_agent: {
    title: "Umfrage → Agent (Verfeinern)",
    description:
      "Verfeinert nur den avatar-spezifischen Teil; globale DigitalTwin-Regeln bleiben aktiv und Markenbotschafter-Ton wird korrigiert.",
    icon: ClipboardList,
  },
};

export function DtGlobalPromptsPanel(props: {
  drafts: GlobalPrompts;
  saved: GlobalPrompts;
  globalChecklistDraft: string;
  globalChecklistSaved: string;
  texterDraft: string;
  texterSaved: string;
  texterIsDefault: boolean;
  texterPersisted: boolean;
  texterMessage: string | null;
  busy: boolean;
  onDraftChange: (slug: keyof GlobalPrompts, value: string) => void;
  onSave: (slug: keyof GlobalPrompts) => void;
  onGlobalChecklistDraftChange: (value: string) => void;
  onSaveGlobalChecklist: () => void;
  onTexterDraftChange: (value: string) => void;
  onSaveTexter: () => void;
  onResetTexter: () => void;
}) {
  const checklistDirty =
    props.globalChecklistDraft.trim() !== props.globalChecklistSaved.trim();
  const checklistCount = textToChecklist(props.globalChecklistDraft).length;
  const texterDirty = props.texterDraft.trim() !== props.texterSaved.trim();

  return (
    <div className="grid gap-4">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white">
          Globale Standard-Prompts
        </h2>
        <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
          Diese Prompts gelten plattformweit. Agent-Prompts nutzen{" "}
          <code className="rounded bg-sbkm-navy/5 px-1 text-xs dark:bg-white/10">
            {"{{organisation}}"}
          </code>
          ; Umfrage-Konvertierung nutzt{" "}
          <code className="rounded bg-sbkm-navy/5 px-1 text-xs dark:bg-white/10">
            {"{{reference_examples}}"}
          </code>{" "}
          für Referenz-Personas.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            "default",
            "seo_advisor",
            "survey_to_agent",
            "survey_refine_agent",
          ] as const
        ).map((slug) => {
          const meta = PROMPT_META[slug];
          const Icon = meta.icon;
          const dirty =
            props.drafts[slug].trim() !== props.saved[slug].trim() &&
            props.drafts[slug].trim() !== "";

          return (
            <DtGlassCard key={slug} variant="subtle" padding="none" className="grid gap-4 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
                  <Icon className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="font-semibold tracking-tight text-sbkm-navy dark:text-white">
                    {meta.title}
                  </p>
                  <p className="mt-0.5 text-sm text-sbkm-ink-600 dark:text-white/55">
                    {meta.description}
                  </p>
                </div>
              </div>
              <Textarea
                value={props.drafts[slug]}
                disabled={props.busy}
                onChange={(e) => props.onDraftChange(slug, e.target.value)}
                className="min-h-[200px] font-mono text-sm leading-relaxed"
                placeholder={meta.placeholder ?? "Prompt …"}
              />
              <div className="flex justify-end">
                <DtPillButton
                  type="button"
                  size="sm"
                  disabled={props.busy || !dirty}
                  onClick={() => props.onSave(slug)}
                >
                  Global speichern
                </DtPillButton>
              </div>
            </DtGlassCard>
          );
        })}
      </div>

      <DtGlassCard
        id="texter-prompt"
        variant="subtle"
        padding="none"
        className="scroll-mt-24 grid gap-4 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
            <FileText className="size-5" aria-hidden />
          </div>
          <div>
            <p className="font-semibold tracking-tight text-sbkm-navy dark:text-white">Texter</p>
            <p className="mt-0.5 text-sm text-sbkm-ink-600 dark:text-white/55">
              Allgemeine Regeln für jeden Seitentyp im SEO-Schritt von Texte. Die sechs Textvorlagen
              (Startseite, Hauptsilo, Unterseite, Ratgeber, Standort, Über uns) stehen auf der Seite{" "}
              <Link href="/dashboard/verwaltung/texte" className="font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint">
                Texte
              </Link>
              . Bei Widerspruch gilt die Textvorlage. Gilt ab dem nächsten SEO-Schritt.
            </p>
          </div>
        </div>
        {props.texterMessage ? (
          <p className="rounded-lg border border-orange-300/70 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
            {props.texterMessage}
          </p>
        ) : null}
        <Textarea
          value={props.texterDraft}
          disabled={props.busy || !props.texterPersisted}
          onChange={(e) => props.onTexterDraftChange(e.target.value)}
          className="min-h-[320px] font-mono text-sm leading-relaxed"
          placeholder="Allgemeine Regeln für den Texter …"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45">
            {props.texterIsDefault && !texterDirty ? "Standard · " : ""}
            {props.texterDraft.length.toLocaleString("de-DE")} Zeichen
          </p>
          <div className="flex flex-wrap gap-2">
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              disabled={props.busy || !props.texterPersisted || (props.texterIsDefault && !texterDirty)}
              onClick={props.onResetTexter}
            >
              Auf Standard zurücksetzen
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              disabled={props.busy || !props.texterPersisted || !texterDirty}
              onClick={props.onSaveTexter}
            >
              Texter-Prompt speichern
            </DtPillButton>
          </div>
        </div>
      </DtGlassCard>

      <DtGlassCard
        id="global-seo-checklist"
        variant="subtle"
        padding="none"
        className="scroll-mt-24 grid gap-4 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-navy/5 text-sbkm-navy dark:bg-white/10 dark:text-white">
            <CheckSquare className="size-5" aria-hidden />
          </div>
          <div>
            <p className="font-semibold tracking-tight text-sbkm-navy dark:text-white">
              Globale SEO-Checkliste
            </p>
            <p className="mt-0.5 text-sm text-sbkm-ink-600 dark:text-white/55">
              Standard-Checkliste für alle Organisationen ohne eigene Liste. Wird im SEO-Agent-Prompt
              unter „SEO-Checkliste" eingefügt.
            </p>
          </div>
        </div>
        <Textarea
          value={props.globalChecklistDraft}
          disabled={props.busy}
          onChange={(e) => props.onGlobalChecklistDraftChange(e.target.value)}
          className="min-h-[160px] text-sm leading-relaxed"
          placeholder={"Meta-Titel pro Seite optimieren\nH1 enthält Fokus-Keyword\nInterne Verlinkung prüfen"}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs tabular-nums text-sbkm-ink-500 dark:text-white/45">
            {checklistCount} {checklistCount === 1 ? "Punkt" : "Punkte"}
          </p>
          <DtPillButton
            type="button"
            size="sm"
            disabled={props.busy || !checklistDirty}
            onClick={props.onSaveGlobalChecklist}
          >
            Globale Checkliste speichern
          </DtPillButton>
        </div>
      </DtGlassCard>
    </div>
  );
}

export type { GlobalPrompts };
