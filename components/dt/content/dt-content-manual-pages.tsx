"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi } from "@/components/dt/content/content-api";
import { parseManualPageLines } from "@/lib/dt/content/manual-pages";
import type { ContentOverview } from "@/lib/dt/content/types";

export function DtContentManualPages(props: {
  organisationId: string;
  onSaved: (overview: ContentOverview) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const pages = parseManualPageLines(text);
    if (pages.length === 0) {
      toast.error("Bitte mindestens einen Seitennamen eintragen.");
      return;
    }
    setSaving(true);
    try {
      const res = await contentApi<ContentOverview>("/api/dt/content/pages", {
        method: "POST",
        body: { organisationId: props.organisationId, pages },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(pages.length === 1 ? "Seite gespeichert." : "Seiten gespeichert.");
      setText("");
      props.onSaved(res.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="seiten-eintragen"
      aria-label="Seiten eintragen"
      className="relative scroll-mt-24 overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <header className="border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seiten eintragen</h2>
        <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
          Eine Seite pro Zeile. Optional mit Suchbegriff: <span className="font-medium">Name | Suchbegriff</span>.
          Vorhandene Seiten bleiben, auch wenn sie schon Text haben.
        </p>
      </header>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          placeholder={"Dachsanierung | Dachsanierung Musterstadt\nKontakt\nÜber uns"}
          className="w-full resize-y rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 py-2 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:border-white/15 dark:bg-black/20 dark:text-white"
        />
        <div className="flex justify-end">
          <DtPillButton type="button" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Seiten speichern
          </DtPillButton>
        </div>
      </div>
    </section>
  );
}
