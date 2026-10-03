"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { cn } from "@/components/dt/cn";
import type {
  ContentLocalSources,
  ContentReadiness,
  ContentReadinessCheckId,
} from "@/lib/dt/content/types";

const FALLBACK_LABELS: Record<ContentReadinessCheckId, string> = {
  anbieter: "Anbieterfakten",
  avatar: "Avatar",
  structure: "Webseitenstruktur-Excel",
};

function fixLink(id: ContentReadinessCheckId, organisationId: string) {
  const org = encodeURIComponent(organisationId);
  switch (id) {
    case "anbieter":
      return { href: `/dashboard/frageboegen?org=${org}`, label: "Zu den Fragebögen" };
    case "avatar":
      return { href: `/dashboard/verwaltung/agents?org=${org}`, label: "Zu den Avataren" };
    case "structure":
      return { href: `/dashboard/verwaltung/seo?org=${org}&tab=struktur`, label: "Zur Seitenstruktur" };
  }
}

function localNote(id: ContentReadinessCheckId, local: ContentLocalSources | null): string | null {
  if (!local) return null;
  switch (id) {
    case "anbieter":
      return local.anbieter
        ? `Im DigitalTwin: „${local.anbieter.surveyTitle}“`
        : "Im DigitalTwin: kein abgeschlossener Anbieter-Fragebogen";
    case "avatar":
      return local.avatarCount > 0
        ? `Im DigitalTwin: ${local.avatarCount} Avatar${local.avatarCount === 1 ? "" : "e"}`
        : "Im DigitalTwin: noch kein Avatar";
    case "structure":
      return local.structure
        ? `Im DigitalTwin: ${local.structure.filename ?? "Struktur hinterlegt"}`
        : "Im DigitalTwin: keine Seitenstruktur hochgeladen";
  }
}

export function DtContentReadinessCard(props: {
  organisationId: string;
  readiness: ContentReadiness | null;
  local: ContentLocalSources | null;
  loading: boolean;
  error: string | null;
}) {
  const checks: ContentReadiness["checks"] =
    props.readiness?.checks ??
    (["anbieter", "avatar", "structure"] as const).map((id) => ({
      id,
      ok: false,
      label: FALLBACK_LABELS[id],
      hint: "",
    }));

  return (
    <section
      aria-label="Voraussetzungen"
      className="relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
            Bereit für Texte?
          </h2>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/60">
            Diese drei Dinge braucht der Content-Agent, bevor er schreiben kann.
          </p>
        </div>
        {props.loading ? (
          <Loader2 className="size-4 animate-spin text-sbkm-ink-500" aria-label="Lädt" />
        ) : props.readiness ? (
          <span
            className={cn(
              "rounded-pill px-2.5 py-1 text-[11px] font-bold",
              props.readiness.ready
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
            )}
          >
            {props.readiness.ready
              ? "Alles bereit"
              : `${checks.filter((c) => !c.ok).length} offen`}
          </span>
        ) : null}
      </header>

      {props.error ? (
        <p className="px-4 py-3 text-sm text-red-700 dark:text-red-300 sm:px-5">{props.error}</p>
      ) : null}

      <ul className="grid gap-px bg-sbkm-navy/8 dark:bg-white/8 sm:grid-cols-3">
        {checks.map((check) => {
          const link = fixLink(check.id, props.organisationId);
          const note = localNote(check.id, props.local);
          const pending = props.loading && !props.readiness;
          return (
            <li
              key={check.id}
              className="flex flex-col gap-2 bg-white/70 px-4 py-4 dark:bg-sbkm-navy/60 sm:px-5"
            >
              <div className="flex items-center gap-2">
                {pending ? (
                  <span className="size-5 animate-pulse rounded-full bg-sbkm-navy/10 dark:bg-white/10" />
                ) : check.ok ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Erledigt" />
                ) : (
                  <XCircle className="size-5 shrink-0 text-red-600 dark:text-red-400" aria-label="Fehlt" />
                )}
                <span className="text-sm font-semibold text-sbkm-navy dark:text-white">
                  {check.label || FALLBACK_LABELS[check.id]}
                </span>
              </div>
              {check.hint ? (
                <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/65">{check.hint}</p>
              ) : null}
              {note ? (
                <p className="text-[11px] text-sbkm-ink-500 dark:text-white/45">{note}</p>
              ) : null}
              {link ? (
                <Link
                  href={link.href}
                  className={cn(
                    "mt-auto inline-flex w-fit items-center gap-1 rounded-pill text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
                    check.ok
                      ? "text-sbkm-ink-600 dark:text-white/60"
                      : "text-sbkm-navy dark:text-sbkm-mint",
                  )}
                >
                  {link.label}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
