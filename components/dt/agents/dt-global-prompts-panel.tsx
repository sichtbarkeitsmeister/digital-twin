"use client";

import { Blend, CheckSquare, Globe2, RotateCcw, Sparkles, UsersRound } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";
import { textToChecklist } from "@/lib/dt/seo/seo-checklist";

type GlobalPrompts = {
  default: string;
  seo_advisor: string;
  avatar_generator: string;
  avatar_mix: string;
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
  avatar_generator: {
    title: "Anbieter-Avatare",
    description:
      "Erstellt im Transkripte-Schritt Avatar-Plan den avatar-spezifischen Teil jedes Avatars. Der globale DigitalTwin-Prompt steht zur Laufzeit davor.",
    icon: UsersRound,
  },
  avatar_mix: {
    title: "Mix-Avatar",
    description:
      "Erstellt unter Agenten den Mix aus den ausgewählten Zielgruppen-Avataren. Der globale DigitalTwin-Prompt steht zur Laufzeit davor.",
    icon: Blend,
  },
};

/** Prompts with a built-in default from code; their card gets „Auf Standard zurücksetzen“. */
const RESETTABLE: Partial<Record<keyof GlobalPrompts, true>> = { avatar_generator: true, avatar_mix: true };

export function DtGlobalPromptsPanel(props: {
  drafts: GlobalPrompts;
  saved: GlobalPrompts;
  globalChecklistDraft: string;
  globalChecklistSaved: string;
  busy: boolean;
  onDraftChange: (slug: keyof GlobalPrompts, value: string) => void;
  onSave: (slug: keyof GlobalPrompts) => void;
  /** „Auf Standard zurücksetzen“: saves the default from code (only for resettable prompts). */
  onReset?: (slug: keyof GlobalPrompts) => void;
  /** Whether the saved text already equals the default from code. */
  isDefault?: (slug: keyof GlobalPrompts) => boolean;
  onGlobalChecklistDraftChange: (value: string) => void;
  onSaveGlobalChecklist: () => void;
}) {
  const checklistDirty =
    props.globalChecklistDraft.trim() !== props.globalChecklistSaved.trim();
  const checklistCount = textToChecklist(props.globalChecklistDraft).length;

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
          .
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(
          ["default", "seo_advisor", "avatar_generator", "avatar_mix"] as const
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
              <div className="flex flex-wrap justify-end gap-2">
                {RESETTABLE[slug] && props.onReset ? (
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={props.busy || (Boolean(props.isDefault?.(slug)) && !dirty)}
                    onClick={() => props.onReset?.(slug)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Auf Standard zurücksetzen
                  </DtPillButton>
                ) : null}
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
              unter „SEO-Checkliste“ eingefügt.
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
