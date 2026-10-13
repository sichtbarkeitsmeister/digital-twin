"use client";

import { useEffect, useState } from "react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import { evaluateGroundingPageSchedule } from "@/lib/dt/seo/grounding-page-schedule";
import {
  slugifyGroundingName,
  type GroundingEntityPage,
  type GroundingReleaseStatus,
} from "@/lib/dt/seo/grounding-pages";

const fieldClass =
  "h-10 w-full rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white";

function dateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function dateStored(value: string): string | null {
  return value ? `${value}T12:00:00.000Z` : null;
}

function statusLabel(lastReviewed: string | null, uploadedAt: string | null): string {
  return evaluateGroundingPageSchedule({ lastReviewed, uploadedAt }).toolStatus;
}

export function DtSeoGroundingEntities(props: {
  canEdit: boolean;
  saving: boolean;
  entities: GroundingEntityPage[];
  onSave: (pages: GroundingEntityPage[]) => void;
}) {
  const [rows, setRows] = useState(props.entities);

  useEffect(() => {
    setRows(props.entities);
  }, [props.entities]);

  function patch(id: string, next: Partial<GroundingEntityPage>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        slug: "",
        title: "",
        url: null,
        uploadedAt: null,
        dateModified: null,
        lastReviewed: null,
        reviewedBy: null,
        notes: null,
        releaseStatus: "draft",
        standardVersion: null,
      },
    ]);
  }

  function save() {
    const pages: GroundingEntityPage[] = [];
    for (const row of rows) {
      const title = row.title.trim();
      const slug = (row.slug.trim() || slugifyGroundingName(title)).trim();
      if (!title && !slug) continue;
      pages.push({ ...row, title, slug: slug || row.slug });
    }
    props.onSave(pages);
  }

  return (
    <DtGlassCard variant="subtle" className="grid gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">Entitätsseiten</h3>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
            Eine Seite je Entität. Die Fälligkeit folgt auch hier lastReviewed. Bestehende URLs
            bleiben, es wird nicht auf /grounding/ umgezogen.
          </p>
        </div>
        <Badge variant="outline">{rows.length}</Badge>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
          Noch keine Entitätsseite. Der Auftrag schlägt sie im Checkpoint vor. Sobald sie online
          sind, trägst du URL und Prüfdatum hier ein.
        </p>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-3 rounded-xl border border-sbkm-navy/10 p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                  {row.title.trim() || "Neue Entitätsseite"}
                </p>
                <Badge variant="outline" className={cn("font-medium")}>
                  {statusLabel(row.lastReviewed, row.uploadedAt)}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={row.title}
                  disabled={!props.canEdit || props.saving}
                  placeholder="Entitätsname"
                  onChange={(e) => patch(row.id, { title: e.target.value })}
                  onBlur={() => {
                    if (!row.slug.trim() && row.title.trim()) {
                      patch(row.id, { slug: slugifyGroundingName(row.title) });
                    }
                  }}
                  className={fieldClass}
                />
                <input
                  value={row.slug}
                  disabled={!props.canEdit || props.saving}
                  placeholder="slug"
                  onChange={(e) => patch(row.id, { slug: e.target.value.toLowerCase() })}
                  className={fieldClass}
                />
              </div>
              <input
                type="url"
                value={row.url ?? ""}
                disabled={!props.canEdit || props.saving}
                placeholder="https://…/grounding/…"
                onChange={(e) => patch(row.id, { url: e.target.value || null })}
                className={fieldClass}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                    Zuletzt geprüft
                  </span>
                  <input
                    type="date"
                    value={dateInput(row.lastReviewed)}
                    disabled={!props.canEdit || props.saving}
                    onChange={(e) => patch(row.id, { lastReviewed: dateStored(e.target.value) })}
                    className={fieldClass}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                    Prüfer
                  </span>
                  <input
                    value={row.reviewedBy ?? ""}
                    disabled={!props.canEdit || props.saving}
                    onChange={(e) => patch(row.id, { reviewedBy: e.target.value || null })}
                    className={fieldClass}
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                  Freigabe
                </span>
                <select
                  value={row.releaseStatus ?? ""}
                  disabled={!props.canEdit || props.saving}
                  onChange={(e) =>
                    patch(row.id, {
                      releaseStatus: (e.target.value || null) as GroundingReleaseStatus | null,
                    })
                  }
                  className={fieldClass}
                >
                  <option value="">Nicht gesetzt</option>
                  <option value="draft">Entwurf</option>
                  <option value="released">Freigegeben</option>
                </select>
              </label>
              {props.canEdit ? (
                <button
                  type="button"
                  className="justify-self-start text-xs font-semibold text-destructive"
                  disabled={props.saving}
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  Entfernen
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {props.canEdit ? (
        <div className="flex flex-wrap gap-2">
          <DtPillButton type="button" size="sm" variant="outline" disabled={props.saving} onClick={addRow}>
            Entitätsseite hinzufügen
          </DtPillButton>
          <DtPillButton type="button" size="sm" disabled={props.saving} onClick={save}>
            Entitätsseiten speichern
          </DtPillButton>
        </div>
      ) : null}
    </DtGlassCard>
  );
}
