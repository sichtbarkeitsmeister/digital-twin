"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import type { CompanyProfileEditView } from "@/lib/dt/company-profile";

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DtCompanyProfileEditsAdmin() {
  const [edits, setEdits] = useState<CompanyProfileEditView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dt/company-profile/edits?unreviewed=1");
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        edits?: CompanyProfileEditView[];
      };
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Änderungen konnten nicht geladen werden.");
        return;
      }
      setEdits(json.edits ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function markReviewed(editId: string) {
    setBusyId(editId);
    try {
      const res = await fetch("/api/dt/company-profile/edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editId }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Konnte nicht als gesehen markiert werden.");
        return;
      }
      toast.success("Als gesehen markiert.");
      setEdits((prev) => prev.filter((row) => row.id !== editId));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="grid gap-1 border-b border-sbkm-navy/8 pb-6 dark:border-white/8">
        <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
          Firmenprofil-Änderungen
        </h1>
        <p className="max-w-2xl text-sm text-sbkm-ink-600 dark:text-white/60">
          Kunden speichern Stammdaten, Ansprechpartner und Anbieter-Punkte direkt. Hier sehen Sie
          jede Änderung — vorher und nachher.
        </p>
      </header>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-sbkm-ink-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Lade…
        </p>
      ) : edits.length === 0 ? (
        <DtGlassCard variant="subtle" className="py-10 text-center text-sm text-sbkm-ink-600">
          Keine ungesehenen Firmenprofil-Änderungen.
        </DtGlassCard>
      ) : (
        <ul className="grid gap-4">
          {edits.map((edit) => (
            <li key={edit.id}>
              <DtGlassCard variant="subtle" className="grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sbkm-navy dark:text-white">
                      {edit.organisation_name ?? "Organisation"}
                    </p>
                    <p className="text-xs text-sbkm-ink-500">{formatWhen(edit.created_at)}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {edit.changes.length} Feld{edit.changes.length === 1 ? "" : "er"}
                  </Badge>
                </div>
                {edit.note ? (
                  <p className="rounded-xl border border-sbkm-mint/25 bg-sbkm-mint/10 px-3 py-2 text-sm text-sbkm-navy dark:text-white/80">
                    {edit.note}
                  </p>
                ) : null}
                <ul className="grid gap-2">
                  {edit.changes.map((change) => (
                    <li
                      key={change.key}
                      className="rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.02] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
                    >
                      <p className="font-semibold text-sbkm-navy dark:text-white">{change.label}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-sbkm-ink-500">
                            Vorher
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sbkm-ink-600 dark:text-white/65">
                            {change.before.trim() || "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-sbkm-ink-500">
                            Nachher
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sbkm-ink-600 dark:text-white/65">
                            {change.after.trim() || "—"}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div>
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busyId === edit.id}
                    onClick={() => void markReviewed(edit.id)}
                  >
                    {busyId === edit.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    Gesehen
                  </DtPillButton>
                </div>
              </DtGlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
