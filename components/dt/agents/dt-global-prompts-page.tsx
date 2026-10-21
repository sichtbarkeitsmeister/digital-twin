"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  DtGlobalPromptsPanel,
  type GlobalPrompts,
} from "@/components/dt/agents/dt-global-prompts-panel";
import { DtContentStepPromptCards } from "@/components/dt/content/dt-content-step-prompt-cards";
import { DtTexterPromptCard } from "@/components/dt/content/dt-texter-prompt-card";
import { DEFAULT_MIX_PROMPT } from "@/lib/dt/agents/mix-prompt";
import { checklistToText } from "@/lib/dt/seo/seo-checklist";
import { DEFAULT_AVATAR_GENERATOR_PROMPT } from "@/lib/dt/transcripts/avatar-generator-prompt";

const EMPTY_PROMPTS: GlobalPrompts = {
  default: "",
  seo_advisor: "",
  avatar_generator: DEFAULT_AVATAR_GENERATOR_PROMPT,
  avatar_mix: DEFAULT_MIX_PROMPT,
};

/** Built-in defaults: an empty or missing row means this text at runtime. */
const PROMPT_DEFAULTS: Partial<GlobalPrompts> = {
  avatar_generator: DEFAULT_AVATAR_GENERATOR_PROMPT,
  avatar_mix: DEFAULT_MIX_PROMPT,
};

export function DtGlobalPromptsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<GlobalPrompts>(EMPTY_PROMPTS);
  const [drafts, setDrafts] = useState<GlobalPrompts>(EMPTY_PROMPTS);
  const [checklistSaved, setChecklistSaved] = useState("");
  const [checklistDraft, setChecklistDraft] = useState("");

  const load = useCallback(async () => {
    const [globalRes, checklistRes] = await Promise.all([
      fetch("/api/dt/agents/default-prompt"),
      fetch("/api/dt/platform-settings/seo-checklist"),
    ]);

    const globalJson = (await globalRes.json()) as {
      ok?: boolean;
      message?: string;
      prompts?: Partial<GlobalPrompts>;
    };
    if (!globalJson.ok || !globalJson.prompts) {
      throw new Error(globalJson.message ?? "Globale Prompts konnten nicht geladen werden.");
    }

    const next: GlobalPrompts = {
      default: globalJson.prompts.default ?? "",
      seo_advisor: globalJson.prompts.seo_advisor ?? "",
      avatar_generator: globalJson.prompts.avatar_generator?.trim() || DEFAULT_AVATAR_GENERATOR_PROMPT,
      avatar_mix: globalJson.prompts.avatar_mix?.trim() || DEFAULT_MIX_PROMPT,
    };
    setSaved(next);
    setDrafts(next);

    const checklistJson = (await checklistRes.json()) as {
      ok?: boolean;
      message?: string;
      checklist?: unknown;
    };
    if (!checklistJson.ok) {
      throw new Error(checklistJson.message ?? "Globale Checkliste konnte nicht geladen werden.");
    }
    const text = checklistToText(checklistJson.checklist);
    setChecklistSaved(text);
    setChecklistDraft(text);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Laden fehlgeschlagen.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function savePrompt(slug: keyof GlobalPrompts, text: string = drafts[slug]) {
    setBusy(true);
    const res = await fetch("/api/dt/agents/default-prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, prompt: text }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Globaler Prompt konnte nicht gespeichert werden.");
      return false;
    }
    setSaved((prev) => ({ ...prev, [slug]: text }));
    setDrafts((prev) => ({ ...prev, [slug]: text }));
    toast.success("Globaler Prompt übernommen — gilt ab sofort für alle Organisationen.");
    return true;
  }

  async function resetPrompt(slug: keyof GlobalPrompts) {
    const fallback = PROMPT_DEFAULTS[slug];
    if (!fallback) return;
    if (!window.confirm("Diesen Prompt auf den Standard zurücksetzen? Eigene Formulierungen gehen verloren.")) return;
    await savePrompt(slug, fallback);
  }

  async function saveChecklist() {
    setBusy(true);
    const res = await fetch("/api/dt/platform-settings/seo-checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checklist: checklistDraft
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Globale Checkliste konnte nicht gespeichert werden.");
      return;
    }
    setChecklistSaved(checklistDraft);
    toast.success("Globale SEO-Checkliste gespeichert.");
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="grid gap-1 border-b border-sbkm-navy/8 pb-6 dark:border-white/8">
        <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
          Globale Prompts
        </h1>
        <p className="max-w-2xl text-sm text-sbkm-ink-600 dark:text-white/60">
          Plattformweite Standard-Prompts und die SEO-Checkliste. Der Text-Prompt steht direkt darunter und gilt für
          jeden Seitentyp unter Texte, danach folgen die Anweisungen der Texte-Schritte SEO bis Lektorat.
        </p>
      </header>

      <DtTexterPromptCard placement="global" />

      <DtContentStepPromptCards />

      {loading ? (
        <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
          Globale Prompts werden geladen …
        </p>
      ) : (
        <DtGlobalPromptsPanel
          drafts={drafts}
          saved={saved}
          globalChecklistDraft={checklistDraft}
          globalChecklistSaved={checklistSaved}
          busy={busy}
          onDraftChange={(slug, value) => setDrafts((prev) => ({ ...prev, [slug]: value }))}
          onSave={(slug) => void savePrompt(slug)}
          onReset={(slug) => void resetPrompt(slug)}
          isDefault={(slug) => saved[slug].trim() === (PROMPT_DEFAULTS[slug] ?? "").trim()}
          onGlobalChecklistDraftChange={setChecklistDraft}
          onSaveGlobalChecklist={() => void saveChecklist()}
        />
      )}
    </div>
  );
}
