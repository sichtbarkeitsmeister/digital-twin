"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Palette, RotateCcw, Save, ScanSearch, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { cn } from "@/components/dt/cn";
import type { GroundingDesignPayload } from "@/lib/dt/seo/grounding-design/api-types";
import { normalizeHex } from "@/lib/dt/seo/grounding-design/color";
import { designStyleBlock } from "@/lib/dt/seo/grounding-design/css";
import { SYSTEM_STACKS, SYSTEM_STACK_KEYS, type SystemStackKey } from "@/lib/dt/seo/grounding-design/fonts";
import {
  DESIGN_COLOR_KEYS,
  DESIGN_COLOR_LABELS,
  type DesignColorKey,
  type DesignFontRole,
  type GroundingDesignProfile,
  type GroundingFont,
  type ManualDesignEdit,
  type ResolvedDesign,
  NEUTRAL_DESIGN,
  applyManualEdit,
  designContrastWarnings,
  designProfileView,
  resolveGroundingDesign,
} from "@/lib/dt/seo/grounding-design/profile";

/**
 * „Design der Grounding Page“: colours, fonts and heading style of the client's website for
 * the Grounding Pages. Detected automatically on every Grounding check and with „Design neu
 * erkennen“; a person can override any field („manuell“), which no detection overwrites.
 */

const ENDPOINT = "/api/dt/seo/grounding/design";
const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50";
const INPUT_CLASS =
  "h-9 min-w-0 rounded-xl border border-sbkm-navy/15 bg-white/80 px-2.5 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white";

type Busy = "save" | "detect" | "reset" | null;
type SourceTone = "auto" | "manuell" | "extern" | "standard";

const TONE_CLASS: Record<SourceTone, string> = {
  auto: "bg-sbkm-mint/25 text-sbkm-navy dark:text-sbkm-mint",
  manuell: "bg-sky-500/15 text-sky-900 dark:text-sky-100",
  extern: "bg-amber-500/15 text-amber-900 dark:text-amber-100",
  standard: "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/60",
};

function SourceLabel({ tone, children }: { tone: SourceTone; children: React.ReactNode }) {
  return <span className={cn("rounded-pill px-2 py-0.5 text-[10.5px] font-semibold", TONE_CLASS[tone])}>{children}</span>;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The system stack a font ends with (manual fonts are „Name, <stack>“). */
function stackKeyOf(font: GroundingFont | undefined): SystemStackKey {
  if (!font) return "sans";
  return SYSTEM_STACK_KEYS.find((k) => font.css_stack.endsWith(SYSTEM_STACKS[k].stack)) ?? "sans";
}

function fontLabel(field: GroundingDesignProfile["fonts"][DesignFontRole], enabled: boolean): { tone: SourceTone; text: string } {
  if (!enabled || !field) return { tone: "standard", text: "Standard" };
  if (field.source === "manuell") return { tone: "manuell", text: "manuell" };
  if (field.value.source === "external") return { tone: "extern", text: "extern geladen – Systemschrift verwendet" };
  if (field.value.source === "self-hosted") return { tone: "auto", text: "von der Website (selbst gehostet)" };
  return { tone: "auto", text: "von der Website" };
}

function previewHtml(design: ResolvedDesign | null): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${designStyleBlock(design)}</head><body><main style="padding:1rem">
<nav><ol class="breadcrumb"><li><a href="#">Startseite</a></li><li>Fakten</li></ol></nav>
<h1>Musterfirma GmbH</h1>
<p class="lead-definition">Die Musterfirma GmbH ist ein Handwerksbetrieb mit Sitz in Hamm.</p>
<p>Sie saniert Dächer und Fassaden in Westfalen. Mehr dazu unter <a href="#">Leistungen</a>.</p>
<h2>Musterfirma GmbH: Kerndaten</h2>
<dl class="data-grid"><dt>Gründung</dt><dd>2012</dd><dt>Telefon</dt><dd><a href="#">02381 12345</a></dd></dl>
<p class="source">Quelle: <a href="#">Impressum</a></p>
</main></body></html>`;
}

type Edit = {
  colors: Partial<Record<DesignColorKey, string | null>>;
  fonts: Partial<Record<DesignFontRole, { name: string; stack: SystemStackKey } | null>>;
  typography: NonNullable<ManualDesignEdit["typography"]>;
};
const EMPTY_EDIT: Edit = { colors: {}, fonts: {}, typography: {} };

function editIsEmpty(edit: Edit): boolean {
  return Object.keys(edit.colors).length + Object.keys(edit.fonts).length + Object.keys(edit.typography).length === 0;
}

export function DtSeoGroundingDesignCard(props: { organisationId: string; canEdit: boolean }) {
  const [data, setData] = useState<GroundingDesignPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [edit, setEdit] = useState<Edit>(EMPTY_EDIT);
  const [hexDraft, setHexDraft] = useState<Partial<Record<DesignColorKey, string>>>({});

  const apply = useCallback((json: GroundingDesignPayload) => {
    setData(json);
    setEdit(EMPTY_EDIT);
    setHexDraft({});
    setNotice(json.migrationMissing ? json.message : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${ENDPOINT}?org=${encodeURIComponent(props.organisationId)}`);
        const json = (await res.json().catch(() => ({}))) as GroundingDesignPayload & { message?: string };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setNotice(json.message ?? "Das Design konnte nicht geladen werden.");
          return;
        }
        apply(json);
      } catch {
        if (!cancelled) setNotice("Das Design konnte nicht geladen werden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.organisationId, apply]);

  const dirty = !editIsEmpty(edit);
  const record = data?.record ?? null;
  const effective = useMemo(() => (dirty ? applyManualEdit(record, edit) : record), [record, edit, dirty]);
  const view = useMemo(() => designProfileView(effective), [effective]);
  const design = useMemo(() => resolveGroundingDesign(effective), [effective]);
  const shown = design ?? NEUTRAL_DESIGN;
  const warnings = useMemo(() => (design ? designContrastWarnings(design) : []), [design]);
  const preview = useMemo(() => previewHtml(design), [design]);
  const enabled = view.enabled && Boolean(design);
  const disabled = !props.canEdit || busy != null || Boolean(data?.migrationMissing) || !data;

  async function post(action: "save" | "reset" | "detect", body: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, action, ...body }),
      });
      const json = (await res.json().catch(() => ({}))) as GroundingDesignPayload & { message?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Das hat nicht geklappt.");
        return;
      }
      apply(json);
      toast.success(
        action === "detect" ? "Design der Website neu erkannt." : action === "reset" ? "Neutrales Standard-Design aktiv." : "Design gespeichert.",
        { description: "Gilt für die nächste Vorschau und jeden Download." },
      );
    } catch {
      toast.error("Das hat nicht geklappt.");
    } finally {
      setBusy(null);
    }
  }

  const setColor = (key: DesignColorKey, value: string | null) => setEdit((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value } }));
  const setFont = (role: DesignFontRole, value: { name: string; stack: SystemStackKey } | null) =>
    setEdit((prev) => ({ ...prev, fonts: { ...prev.fonts, [role]: value } }));
  /** Back to „von der Website“: drop the stored manual value, or just the unsaved edit. */
  const clearColor = (key: DesignColorKey) => {
    setHexDraft((prev) => ({ ...prev, [key]: undefined }));
    setEdit((prev) => {
      const colors = { ...prev.colors };
      if (record?.manual.colors[key] !== undefined) colors[key] = null;
      else delete colors[key];
      return { ...prev, colors };
    });
  };
  const clearFont = (role: DesignFontRole) =>
    setEdit((prev) => {
      const fonts = { ...prev.fonts };
      if (record?.manual.fonts[role] !== undefined) fonts[role] = null;
      else delete fonts[role];
      return { ...prev, fonts };
    });
  const setTypo = <K extends keyof Edit["typography"]>(key: K, value: Edit["typography"][K]) =>
    setEdit((prev) => ({ ...prev, typography: { ...prev.typography, [key]: value } }));

  const colorLabel = (key: DesignColorKey): { tone: SourceTone; text: string } => {
    const field = view.colors[key];
    if (!enabled || !field) return { tone: "standard", text: key === "muted" && enabled ? "abgeleitet" : "Standard" };
    return field.source === "manuell" ? { tone: "manuell", text: "manuell" } : { tone: "auto", text: "von der Website" };
  };
  const typoLabel = (field: { source: "auto" | "manuell" } | undefined) =>
    !enabled || !field ? <SourceLabel tone="standard">Standard</SourceLabel> : field.source === "manuell" ? <SourceLabel tone="manuell">manuell</SourceLabel> : <SourceLabel tone="auto">von der Website</SourceLabel>;

  const report = data?.report ?? null;
  const read = report?.stylesheets.filter((s) => s.status === "read").length ?? 0;

  return (
    <DtGlassCard id="grounding-design" variant="subtle" padding="none" className="grid scroll-mt-24 gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-sbkm-navy dark:text-white">
            <Palette className="size-4" aria-hidden />
            Design der Grounding Page
          </h3>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/55">
            Farben, Schriften und Überschriften der Kunden-Website für die Grounding Page. Wird bei jeder Prüfung („Website prüfen“) neu
            erkannt; manuelle Werte bleiben dabei immer erhalten. Schriften von Google Fonts, Adobe Fonts oder anderen fremden Servern lädt die
            Seite nie (Datenschutz) – sie nutzt dann eine ähnliche Systemschrift. Nur Schriftdateien auf der eigenen Domain des Kunden werden
            eingebunden.
          </p>
        </div>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-sbkm-ink-500" aria-label="Lädt" />
        ) : (
          <SourceLabel tone={enabled ? "auto" : "standard"}>{enabled ? "Design der Website" : "Neutrales Standard-Design"}</SourceLabel>
        )}
      </div>

      {notice ? (
        <p className="flex items-start gap-2 rounded-lg border border-orange-300/70 bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
            {view.detected_at
              ? `Zuletzt erkannt am ${formatDateTime(view.detected_at)} von ${view.detected_from_url ?? data.websiteUrl ?? "der Website"} (${read} CSS-${read === 1 ? "Datei" : "Dateien"} gelesen${report?.themes.length ? `, ${report.themes.join(", ")}` : ""}).`
              : "Noch nicht erkannt. „Design neu erkennen“ liest die Startseite und ihr CSS; sonst geschieht das bei der nächsten Prüfung."}
            {!view.enabled ? " Zurzeit gilt das neutrale Standard-Design; „Design neu erkennen“ oder Speichern schaltet das Website-Design wieder ein." : ""}
          </p>

          <div className="grid gap-4">
            <div className="grid content-start gap-4">
              <div className="grid gap-2">
                <p className={LABEL_CLASS}>Farben</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DESIGN_COLOR_KEYS.map((key) => {
                    const value = shown.colors[key];
                    const label = colorLabel(key);
                    const manual = view.colors[key]?.source === "manuell";
                    const hexValue = hexDraft[key] ?? value;
                    return (
                      <div key={key} className="grid gap-1 rounded-xl border border-sbkm-navy/10 bg-white/50 p-2 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-sbkm-navy dark:text-white" title={DESIGN_COLOR_LABELS[key].hint}>
                            {DESIGN_COLOR_LABELS[key].label}
                            <span className="ml-1 font-normal text-sbkm-ink-600 dark:text-white/50">{DESIGN_COLOR_LABELS[key].hint}</span>
                          </span>
                          <SourceLabel tone={label.tone}>{label.text}</SourceLabel>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            aria-label={`${DESIGN_COLOR_LABELS[key].label}: Farbe wählen`}
                            value={value}
                            disabled={disabled}
                            onChange={(e) => {
                              setColor(key, e.target.value);
                              setHexDraft((prev) => ({ ...prev, [key]: e.target.value }));
                            }}
                            className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-sbkm-navy/15 bg-white p-0.5 disabled:cursor-not-allowed dark:border-white/15"
                          />
                          <input
                            type="text"
                            aria-label={`${DESIGN_COLOR_LABELS[key].label}: Hex-Wert`}
                            value={hexValue}
                            disabled={disabled}
                            maxLength={9}
                            spellCheck={false}
                            onChange={(e) => {
                              setHexDraft((prev) => ({ ...prev, [key]: e.target.value }));
                              const hex = /^#[0-9a-f]{6}$/i.test(e.target.value.trim()) ? normalizeHex(e.target.value) : null;
                              if (hex) setColor(key, hex);
                            }}
                            className={cn(INPUT_CLASS, "w-24 font-mono text-xs")}
                          />
                          {manual && props.canEdit ? (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => clearColor(key)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-sbkm-navy underline-offset-2 hover:underline disabled:opacity-50 dark:text-sbkm-mint"
                              title="Manuellen Wert entfernen, wieder den Wert der Website nutzen"
                            >
                              <Undo2 className="size-3" aria-hidden />
                              Website-Wert
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {warnings.length > 0 ? (
                  <ul className="grid gap-1 text-xs text-amber-900 dark:text-amber-100">
                    {warnings.map((w) => (
                      <li key={w.pair} className="flex gap-1.5">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {w.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="grid gap-2">
                <p className={LABEL_CLASS}>Schriften</p>
                {(["body", "heading"] as const).map((role) => {
                  const field = view.fonts[role];
                  const label = fontLabel(field, enabled);
                  const manual = field?.source === "manuell";
                  const pending = edit.fonts[role];
                  const name = pending ? pending.name : (field?.value.name ?? (role === "heading" ? (view.fonts.body?.value.name ?? "") : ""));
                  const stack: SystemStackKey | "auto" = pending ? pending.stack : manual ? stackKeyOf(field?.value) : "auto";
                  return (
                    <div key={role} className="grid gap-1 rounded-xl border border-sbkm-navy/10 bg-white/50 p-2 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-sbkm-navy dark:text-white">{role === "body" ? "Text" : "Überschriften"}</span>
                        <SourceLabel tone={label.tone}>{label.text}</SourceLabel>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
                        <input
                          type="text"
                          aria-label={`${role === "body" ? "Textschrift" : "Überschriftenschrift"}: Name`}
                          value={name}
                          maxLength={60}
                          placeholder={role === "heading" ? "wie Text" : "Systemschrift"}
                          disabled={disabled || stack === "auto"}
                          onChange={(e) => setFont(role, { name: e.target.value, stack: stack === "auto" ? "sans" : stack })}
                          className={INPUT_CLASS}
                        />
                        <select
                          aria-label={`${role === "body" ? "Textschrift" : "Überschriftenschrift"}: Systemschrift`}
                          value={stack}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = e.target.value as SystemStackKey | "auto";
                            if (next === "auto") clearFont(role);
                            else setFont(role, { name, stack: next });
                          }}
                          className={INPUT_CLASS}
                        >
                          <option value="auto">Automatisch (Website)</option>
                          {SYSTEM_STACK_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {SYSTEM_STACKS[k].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {field && enabled ? (
                        <p className="break-words font-mono text-[10.5px] text-sbkm-ink-600 dark:text-white/45">
                          {field.value.css_stack}
                          {field.value.font_face_urls?.length ? ` · ${field.value.font_face_urls.length} Schriftdatei(en) von der eigenen Domain` : ""}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <p className="text-[11px] text-sbkm-ink-600 dark:text-white/50">
                  Ein eingetragener Name wird nur genutzt, wenn die Schrift auf dem Gerät des Lesers installiert ist; geladen wird nichts.
                </p>
              </div>

              <div className="grid gap-2">
                <p className={LABEL_CLASS}>Überschriften und Grundgröße</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-sbkm-navy dark:text-white">
                    <span className="flex items-center justify-between gap-1">Schriftstärke {typoLabel(view.typography.headingWeight)}</span>
                    <select
                      value={view.typography.headingWeight?.source === "manuell" ? String(view.typography.headingWeight.value) : "auto"}
                      disabled={disabled}
                      onChange={(e) => setTypo("headingWeight", e.target.value === "auto" ? null : Number(e.target.value))}
                      className={INPUT_CLASS}
                    >
                      <option value="auto">
                        Automatisch ({record?.detected?.typography.headingWeight ?? NEUTRAL_DESIGN.headingWeight})
                      </option>
                      {[400, 500, 600, 700, 800].map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-sbkm-navy dark:text-white">
                    <span className="flex items-center justify-between gap-1">Großbuchstaben {typoLabel(view.typography.headingUppercase)}</span>
                    <select
                      value={view.typography.headingUppercase?.source === "manuell" ? String(view.typography.headingUppercase.value) : "auto"}
                      disabled={disabled}
                      onChange={(e) => setTypo("headingUppercase", e.target.value === "auto" ? null : e.target.value === "true")}
                      className={INPUT_CLASS}
                    >
                      <option value="auto">Automatisch ({record?.detected?.typography.headingUppercase ? "ja" : "nein"})</option>
                      <option value="true">Ja</option>
                      <option value="false">Nein</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-sbkm-navy dark:text-white">
                    <span className="flex items-center justify-between gap-1">Laufweite {typoLabel(view.typography.headingLetterSpacing)}</span>
                    <input
                      type="text"
                      value={edit.typography.headingLetterSpacing ?? (view.typography.headingLetterSpacing?.source === "manuell" ? view.typography.headingLetterSpacing.value : "")}
                      placeholder={`automatisch (${record?.detected?.typography.headingLetterSpacing ?? "normal"})`}
                      maxLength={10}
                      disabled={disabled}
                      onChange={(e) => setTypo("headingLetterSpacing", e.target.value.trim() ? e.target.value.trim() : null)}
                      className={cn(INPUT_CLASS, "font-mono text-xs")}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-sbkm-navy dark:text-white">
                    <span className="flex items-center justify-between gap-1">Grundgröße in px {typoLabel(view.typography.baseFontSize)}</span>
                    <input
                      type="number"
                      min={12}
                      max={24}
                      step={0.5}
                      value={edit.typography.baseFontSize ?? (view.typography.baseFontSize?.source === "manuell" ? view.typography.baseFontSize.value : "")}
                      placeholder={`automatisch (${record?.detected?.typography.baseFontSize ?? 16})`}
                      disabled={disabled}
                      onChange={(e) => setTypo("baseFontSize", e.target.value ? Number(e.target.value) : null)}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="grid content-start gap-2">
              <p className={LABEL_CLASS}>Vorschau</p>
              {/* No allow-* tokens: the preview runs without scripts and without same-origin access. */}
              <iframe
                title="Vorschau des Designs"
                sandbox=""
                srcDoc={preview}
                referrerPolicy="no-referrer"
                className="h-[360px] w-full rounded-xl border border-sbkm-navy/15 bg-white dark:border-white/15"
              />
              <p className="text-[11px] leading-relaxed text-sbkm-ink-600 dark:text-white/50">
                Hier im Tool lädt der Browser die Schriftdateien der Kunden-Website oft nicht (fremde Domain, CORS); die Vorschau zeigt dann die
                Ersatzschrift. Auf der Website des Kunden erscheint die richtige Schrift.
              </p>
            </div>
          </div>

          {view.notes.length > 0 ? (
            <div className="grid gap-1">
              <p className={LABEL_CLASS}>Hinweise der Erkennung</p>
              <ul className="grid gap-1 text-xs text-sbkm-navy dark:text-white/80">
                {view.notes.map((n) => (
                  <li key={n} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {props.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <DtPillButton type="button" size="sm" disabled={disabled || !dirty} onClick={() => void post("save", { edit })} className="gap-1.5">
                {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                Speichern
              </DtPillButton>
              <DtPillButton
                type="button"
                size="sm"
                variant="ghost"
                disabled={!dirty || busy != null}
                onClick={() => {
                  setEdit(EMPTY_EDIT);
                  setHexDraft({});
                }}
              >
                Verwerfen
              </DtPillButton>
              <DtPillButton type="button" size="sm" variant="outline" disabled={disabled || !data.websiteUrl} onClick={() => void post("detect")} className="gap-1.5">
                {busy === "detect" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />}
                Design neu erkennen
              </DtPillButton>
              <DtPillButton
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || (!view.enabled && !dirty)}
                onClick={() => {
                  if (window.confirm("Auf das neutrale Standard-Design zurücksetzen? Manuelle Werte werden gelöscht.")) void post("reset");
                }}
                className="gap-1.5 sm:ml-auto"
              >
                {busy === "reset" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                Auf Standard zurücksetzen
              </DtPillButton>
            </div>
          ) : (
            <p className="text-xs text-sbkm-ink-600 dark:text-white/55">Nur Plattform-Admins können das Design ändern.</p>
          )}
        </>
      ) : null}
    </DtGlassCard>
  );
}
