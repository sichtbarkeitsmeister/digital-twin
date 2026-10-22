"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_CUSTOMER_CONTACT,
  DT_ONBOARDING_MAX_CUSTOMER_CONTACTS,
} from "@/lib/dt/onboarding/copy";
import type { CompanyProfile, CompanyProfileContact, CompanyProfileEditRow } from "@/lib/dt/company-profile";
import { ANBIETER_POINTS } from "@/lib/dt/transcripts/workshop-model";
import { organisationOptionLabel, type OrganisationOption } from "@/lib/shared/organisation-option";
import { readSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";
import { cn } from "@/components/dt/cn";

const inputClass =
  "h-10 w-full rounded-pill border border-sbkm-navy/15 px-3 text-sm disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white";

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

export function DtCompanyProfilePage(props: {
  organisations: OrganisationOption[];
  initialOrgId: string;
  initialProfile?: CompanyProfile | null;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [orgId, setOrgId] = useState(props.initialOrgId);
  const [profile, setProfile] = useState<CompanyProfile | null>(props.initialProfile ?? null);
  const [displayName, setDisplayName] = useState(props.initialProfile?.displayName ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(props.initialProfile?.websiteUrl ?? "");
  const [contacts, setContacts] = useState<CompanyProfileContact[]>(
    props.initialProfile?.contacts ?? [{ ...EMPTY_CUSTOMER_CONTACT }],
  );
  const [points, setPoints] = useState<Record<string, string>>(() =>
    Object.fromEntries((props.initialProfile?.points ?? []).map((p) => [p.key, p.current])),
  );
  const [note, setNote] = useState("");
  const [edits, setEdits] = useState<CompanyProfileEditRow[]>([]);
  const [loading, setLoading] = useState(!props.initialProfile);
  const [busy, setBusy] = useState(false);

  const orgName = organisationOptionLabel(props.organisations.find((o) => o.id === orgId));

  const applyProfile = useCallback((next: CompanyProfile) => {
    setProfile(next);
    setDisplayName(next.displayName);
    setWebsiteUrl(next.websiteUrl);
    setContacts(next.contacts.length > 0 ? next.contacts : [{ ...EMPTY_CUSTOMER_CONTACT }]);
    setPoints(Object.fromEntries(next.points.map((p) => [p.key, p.current])));
  }, []);

  const refresh = useCallback(
    async (organisationId: string) => {
      setLoading(true);
      try {
        const profileRes = await fetch(
          `/api/dt/company-profile?org=${encodeURIComponent(organisationId)}`,
        );
        const profileJson = (await profileRes.json()) as {
          ok?: boolean;
          message?: string;
          profile?: CompanyProfile;
        };
        if (!profileRes.ok || !profileJson.ok || !profileJson.profile) {
          toast.error(profileJson.message ?? "Firmenprofil konnte nicht geladen werden.");
          setProfile(null);
          setEdits([]);
          return;
        }
        applyProfile(profileJson.profile);
        if (profileJson.profile.canEdit) {
          const editsRes = await fetch(
            `/api/dt/company-profile/edits?org=${encodeURIComponent(organisationId)}`,
          );
          const editsJson = (await editsRes.json()) as {
            ok?: boolean;
            edits?: CompanyProfileEditRow[];
          };
          setEdits(editsJson.ok ? (editsJson.edits ?? []) : []);
        } else {
          setEdits([]);
        }
      } catch {
        toast.error("Firmenprofil konnte nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    },
    [applyProfile],
  );

  useEffect(() => {
    const fromUrl = searchParams.get("org");
    const fromStorage = readSelectedOrganisationId();
    const next =
      (fromUrl && props.organisations.some((o) => o.id === fromUrl) && fromUrl) ||
      (fromStorage && props.organisations.some((o) => o.id === fromStorage) && fromStorage) ||
      props.initialOrgId;
    if (next !== orgId) setOrgId(next);
  }, [searchParams, props.organisations, props.initialOrgId, orgId]);

  useEffect(() => {
    void refresh(orgId);
  }, [orgId, refresh]);

  function writeOrgQuery(nextOrgId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", nextOrgId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function save() {
    if (!profile?.canEdit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dt/company-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: orgId,
          displayName,
          websiteUrl,
          contacts,
          points: ANBIETER_POINTS.map((point) => ({
            key: point.key,
            current: points[point.key] ?? "",
          })),
          note: note.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        profile?: CompanyProfile;
        changed?: boolean;
      };
      if (!res.ok || !json.ok || !json.profile) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      applyProfile(json.profile);
      setNote("");
      toast.success(
        json.changed
          ? "Gespeichert — Sichtbarkeitsmeister sieht die Änderung."
          : "Keine Änderungen.",
      );
      void refresh(orgId);
    } finally {
      setBusy(false);
    }
  }

  const filledPointCount = useMemo(
    () => ANBIETER_POINTS.filter((point) => (points[point.key] ?? "").trim()).length,
    [points],
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="grid gap-3 border-b border-sbkm-navy/8 pb-6 dark:border-white/8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-sbkm-ink-500 dark:text-white/40">
              {orgName}
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
              Firmenprofil
            </h1>
            <p className="max-w-2xl text-sm text-sbkm-ink-600 dark:text-white/60">
              Stammdaten, Ansprechpartner und alles aus den Workshops — USPs, Leistungen, Ziele und
              mehr. Änderungen speichern Sie direkt; wir sehen, was sich geändert hat.
            </p>
          </div>
          {props.organisations.length > 1 ? (
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-sbkm-ink-500">Organisation</span>
              <select
                className={cn(inputClass, "min-w-[200px]")}
                value={orgId}
                onChange={(event) => {
                  const next = event.target.value;
                  setOrgId(next);
                  writeOrgQuery(next);
                }}
              >
                {props.organisations.map((organisation) => (
                  <option key={organisation.id} value={organisation.id}>
                    {organisationOptionLabel(organisation)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </header>

      {loading && !profile ? (
        <DtGlassCard variant="subtle" className="flex items-center gap-2 py-10 text-sm text-sbkm-ink-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Firmenprofil wird geladen…
        </DtGlassCard>
      ) : !profile ? (
        <DtGlassCard variant="subtle" className="py-10 text-center text-sm text-sbkm-ink-600">
          Kein Firmenprofil gefunden.
        </DtGlassCard>
      ) : (
        <>
          <DtGlassCard variant="subtle" className="grid gap-4">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-sbkm-mint" aria-hidden />
              <h2 className="text-base font-semibold text-sbkm-navy dark:text-white">Stammdaten</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm sm:col-span-2">
                <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Anzeigename</span>
                <input
                  className={inputClass}
                  value={displayName}
                  disabled={!profile.canEdit || busy}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm sm:col-span-2">
                <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">Website</span>
                <input
                  className={inputClass}
                  value={websiteUrl}
                  disabled={!profile.canEdit || busy}
                  placeholder="https://"
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
              </label>
            </div>
          </DtGlassCard>

          <DtGlassCard variant="subtle" className="grid gap-4">
            <div>
              <h2 className="text-base font-semibold text-sbkm-navy dark:text-white">
                Ansprechpartner
              </h2>
              <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
                Kontakte in Ihrem Unternehmen für das Projekt.
              </p>
            </div>
            <div className="grid gap-3">
              {contacts.map((contact, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-2xl border border-sbkm-navy/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/[0.03] sm:grid-cols-2"
                >
                  <input
                    className={inputClass}
                    placeholder="Name"
                    value={contact.name}
                    disabled={!profile.canEdit || busy}
                    onChange={(e) =>
                      setContacts((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)),
                      )
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="Funktion"
                    value={contact.role}
                    disabled={!profile.canEdit || busy}
                    onChange={(e) =>
                      setContacts((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, role: e.target.value } : row)),
                      )
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="E-Mail"
                    value={contact.email}
                    disabled={!profile.canEdit || busy}
                    onChange={(e) =>
                      setContacts((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, email: e.target.value } : row)),
                      )
                    }
                  />
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      placeholder="Telefon"
                      value={contact.phone}
                      disabled={!profile.canEdit || busy}
                      onChange={(e) =>
                        setContacts((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, phone: e.target.value } : row,
                          ),
                        )
                      }
                    />
                    {profile.canEdit && contacts.length > 1 ? (
                      <DtPillButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="shrink-0 px-2.5 text-red-600"
                        onClick={() => setContacts((prev) => prev.filter((_, i) => i !== index))}
                        aria-label="Ansprechpartner entfernen"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </DtPillButton>
                    ) : null}
                  </div>
                </div>
              ))}
              {profile.canEdit && contacts.length < DT_ONBOARDING_MAX_CUSTOMER_CONTACTS ? (
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit gap-1.5"
                  disabled={busy}
                  onClick={() => setContacts((prev) => [...prev, { ...EMPTY_CUSTOMER_CONTACT }])}
                >
                  <Plus className="size-4" aria-hidden />
                  Ansprechpartner hinzufügen
                </DtPillButton>
              ) : null}
            </div>
          </DtGlassCard>

          <DtGlassCard variant="subtle" className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-sbkm-navy dark:text-white">
                  Unternehmen & Positionierung
                </h2>
                <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
                  Aus den Meetings und Workshops — {filledPointCount} von {ANBIETER_POINTS.length}{" "}
                  Punkten ausgefüllt.
                </p>
              </div>
            </div>
            <div className="grid gap-4">
              {ANBIETER_POINTS.map((point) => (
                <label key={point.key} className="grid gap-1 text-sm">
                  <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
                    {point.label}
                  </span>
                  <Textarea
                    value={points[point.key] ?? ""}
                    disabled={!profile.canEdit || busy}
                    onChange={(e) =>
                      setPoints((prev) => ({ ...prev, [point.key]: e.target.value }))
                    }
                    className="min-h-[96px] text-sm"
                    placeholder={`${point.label} ergänzen…`}
                  />
                </label>
              ))}
            </div>
          </DtGlassCard>

          {profile.canEdit ? (
            <DtGlassCard variant="subtle" className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
                  Hinweis an uns (optional)
                </span>
                <Textarea
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-[72px] text-sm"
                  placeholder="Kurz, was Sie geändert haben oder warum…"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <DtPillButton
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy || !displayName.trim()}
                  onClick={() => void save()}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-4" aria-hidden />
                  )}
                  Speichern
                </DtPillButton>
              </div>
            </DtGlassCard>
          ) : (
            <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
              Nur Inhaber und Admins können das Firmenprofil bearbeiten.
            </p>
          )}

          {edits.length > 0 ? (
            <section className="grid gap-3">
              <h2 className="text-base font-semibold text-sbkm-navy dark:text-white">
                Letzte Änderungen
              </h2>
              <ul className="grid gap-2">
                {edits.slice(0, 8).map((edit) => (
                  <li
                    key={edit.id}
                    className="rounded-dt border border-sbkm-navy/10 bg-white/60 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-sbkm-navy dark:text-white">
                        {edit.changes.map((c) => c.label).join(" · ")}
                      </p>
                      <p className="text-xs text-sbkm-ink-500">{formatWhen(edit.created_at)}</p>
                    </div>
                    {edit.note ? (
                      <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">{edit.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
