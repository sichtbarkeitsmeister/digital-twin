"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  DtGlobalPromptsPanel,
  type GlobalPrompts,
} from "@/components/dt/agents/dt-global-prompts-panel";
import { checklistToText } from "@/lib/dt/seo/seo-checklist";

const EMPTY_PROMPTS: GlobalPrompts = {
  default: "",
  seo_advisor: "",
  survey_to_agent: "",
  survey_refine_agent: "",
};

export function DtGlobalPromptsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<GlobalPrompts>(EMPTY_PROMPTS);
  const [drafts, setDrafts] = useState<GlobalPrompts>(EMPTY_PROMPTS);
  const [checklistSaved, setChecklistSaved] = useState("");
  const [checklistDraft, setChecklistDraft] = useState("");
  const [texterSaved, setTexterSaved] = useState("");
  const [texterDraft, setTexterDraft] = useState("");
  const [texterIsDefault, setTexterIsDefault] = useState(true);
  const [texterPersisted, setTexterPersisted] = useState(true);
  const [texterMessage, setTexterMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [globalRes, checklistRes, texterRes] = await Promise.all([
      fetch("/api/dt/agents/default-prompt"),
      fetch("/api/dt/platform-settings/seo-checklist"),
      fetch("/api/dt/platform-settings/texter-prompt"),
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
      survey_to_agent: globalJson.prompts.survey_to_agent ?? "",
      survey_refine_agent: globalJson.prompts.survey_refine_agent ?? "",
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

    const texterJson = (await texterRes.json()) as {
      ok?: boolean;
      message?: string;
      prompt?: string;
      isDefault?: boolean;
      persisted?: boolean;
    };
    if (!texterJson.ok || typeof texterJson.prompt !== "string") {
      throw new Error(texterJson.message ?? "Texter-Prompt konnte nicht geladen werden.");
    }
    setTexterSaved(texterJson.prompt);
    setTexterDraft(texterJson.prompt);
    setTexterIsDefault(texterJson.isDefault !== false);
    setTexterPersisted(texterJson.persisted !== false);
    setTexterMessage(texterJson.persisted === false ? (texterJson.message ?? null) : null);
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

  async function savePrompt(slug: keyof GlobalPrompts) {
    setBusy(true);
    const res = await fetch("/api/dt/agents/default-prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, prompt: drafts[slug] }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Globaler Prompt konnte nicht gespeichert werden.");
      return;
    }
    setSaved((prev) => ({ ...prev, [slug]: drafts[slug] }));
    toast.success("Globaler Prompt übernommen — gilt ab sofort für alle Organisationen.");
  }

  async function saveTexter(next?: string) {
    setBusy(true);
    const prompt = next ?? texterDraft;
    const res = await fetch("/api/dt/platform-settings/texter-prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string; prompt?: string; isDefault?: boolean };
    setBusy(false);
    if (!json.ok || typeof json.prompt !== "string") {
      toast.error(json.message ?? "Texter-Prompt konnte nicht gespeichert werden.");
      return;
    }
    setTexterSaved(json.prompt);
    setTexterDraft(json.prompt);
    setTexterIsDefault(json.isDefault !== false);
    toast.success(
      json.isDefault
        ? "Texter-Prompt auf den Standard zurückgesetzt."
        : "Texter-Prompt gespeichert — gilt ab dem nächsten SEO-Schritt.",
    );
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
          Plattformweite Standard-Prompts und die SEO-Checkliste. Gilt für alle Organisationen.
        </p>
      </header>

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
          onGlobalChecklistDraftChange={setChecklistDraft}
          onSaveGlobalChecklist={() => void saveChecklist()}
          texterDraft={texterDraft}
          texterSaved={texterSaved}
          texterIsDefault={texterIsDefault}
          texterPersisted={texterPersisted}
          texterMessage={texterMessage}
          onTexterDraftChange={setTexterDraft}
          onSaveTexter={() => void saveTexter()}
          onResetTexter={() => {
            if (!window.confirm("Den allgemeinen Texter-Prompt auf den Standard zurücksetzen? Eigene Formulierungen gehen verloren.")) return;
            void saveTexter("");
          }}
        />
      )}
    </div>
  );
}
