"use client";

import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import {
  CONTACT_CUSTOM_FIELDS_MAX,
  CONTACT_CUSTOM_LABEL_MAX,
  CONTACT_CUSTOM_VALUE_MAX,
  CONTACT_FIELD_LABELS,
  CONTACT_FIELD_MAX_CHARS,
  GOOGLE_NOT_FOUND_HINT,
  contactFieldBadge,
  type ContactFieldKey,
  type ContactFormState,
  type OrgContactData,
} from "@/lib/dt/contact-data";

const inputClass =
  "h-9 w-full min-w-0 rounded-[10px] border border-sbkm-navy/15 bg-white px-3 text-sm text-sbkm-navy outline-none transition-[border-color,box-shadow] placeholder:text-sbkm-ink-500 hover:border-sbkm-navy focus:border-sbkm-navy focus:shadow-dt-focus disabled:opacity-60 dark:border-white/15 dark:bg-sbkm-ink-900/80 dark:text-white dark:focus:border-sbkm-mint";

const PLACEHOLDERS: Partial<Record<ContactFieldKey, string>> = {
  firmenname: "z. B. Muster Dach GmbH",
  ansprechpartner: "z. B. Dr. Anna Müller",
  strasse: "z. B. Hauptstraße 12",
  plz: "12345",
  ort: "z. B. Musterstadt",
  telefon: "z. B. 0221 123456",
  mobil: "z. B. 0171 1234567",
  fax: "z. B. 0221 123457",
  email: "z. B. info@beispiel.de",
  website: "https://",
  oeffnungszeiten: "z. B. Mo–Fr 8–17 Uhr, Sa 9–12 Uhr",
  google_profil: "https://maps.app.goo.gl/…",
  facebook: "https://facebook.com/…",
  instagram: "https://instagram.com/…",
  linkedin: "https://linkedin.com/company/…",
  youtube: "https://youtube.com/@…",
  social_sonstige: "XING, TikTok, … (ein Link pro Zeile)",
};

/** Pairs of the compact two-column form; a single key spans both columns. */
const ROWS: ReadonlyArray<readonly ContactFieldKey[]> = [
  ["firmenname", "ansprechpartner"],
  ["strasse", "plz", "ort"],
  ["telefon", "mobil"],
  ["fax", "email"],
  ["website", "oeffnungszeiten"],
  ["google_profil"],
  ["facebook", "instagram"],
  ["linkedin", "youtube"],
  ["social_sonstige"],
];

/**
 * The Kontaktdaten form, shared by Texte („Kontaktdaten“ under „Seitenquelle“) and the
 * Firmenprofil: the same fields, the same data. A field filled by the crawl or the web search
 * shows its source in grey until it is edited; then it counts as „manuell“ on save.
 * `hidden` leaves out fields the surrounding page shows itself (the Firmenprofil's Stammdaten).
 */
export function DtContactDataFields(props: {
  stored: OrgContactData;
  value: ContactFormState;
  onChange: (next: ContactFormState) => void;
  disabled?: boolean;
  hidden?: readonly ContactFieldKey[];
  /** The Google search ran and found nothing (or nothing that matched): the hint under the field. */
  googleNotFound?: boolean;
}) {
  const { value, stored, disabled } = props;
  const hidden = new Set(props.hidden ?? []);
  const setField = (key: ContactFieldKey, next: string) => props.onChange({ ...value, fields: { ...value.fields, [key]: next } });

  const field = (key: ContactFieldKey, className?: string) => {
    if (hidden.has(key)) return null;
    const badge = contactFieldBadge(stored, key, value.fields[key]);
    const multiline = key === "social_sonstige";
    const googleOff = key === "google_profil" && value.no_google_profile;
    return (
      <label key={key} className={cn("grid min-w-0 gap-1 text-xs", className)}>
        <span className="flex flex-wrap items-baseline gap-x-2 font-semibold text-sbkm-navy dark:text-white/85">
          {CONTACT_FIELD_LABELS[key]}
          {badge ? <span className="font-normal text-sbkm-ink-500 dark:text-white/45">{badge}</span> : null}
        </span>
        {multiline ? (
          <textarea
            className={cn(inputClass, "h-16 py-2")}
            value={value.fields[key]}
            disabled={disabled}
            maxLength={CONTACT_FIELD_MAX_CHARS[key]}
            placeholder={PLACEHOLDERS[key]}
            onChange={(e) => setField(key, e.target.value)}
          />
        ) : (
          <input
            className={inputClass}
            value={googleOff ? "" : value.fields[key]}
            disabled={disabled || googleOff}
            maxLength={CONTACT_FIELD_MAX_CHARS[key]}
            placeholder={googleOff ? "Kein Google-Profil" : PLACEHOLDERS[key]}
            inputMode={key === "plz" ? "numeric" : key === "telefon" || key === "mobil" || key === "fax" ? "tel" : undefined}
            type={key === "email" ? "email" : "text"}
            autoComplete="off"
            onChange={(e) => setField(key, e.target.value)}
          />
        )}
      </label>
    );
  };

  return (
    <div className="grid gap-3">
      {ROWS.map((row) => {
        const keys = row.filter((key) => !hidden.has(key));
        if (keys.length === 0) return null;
        if (row.length === 3) {
          // Straße | PLZ + Ort
          return (
            <div key={row.join("-")} className="grid gap-3 sm:grid-cols-2">
              {field("strasse")}
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                {field("plz")}
                {field("ort")}
              </div>
            </div>
          );
        }
        if (row[0] === "google_profil") {
          return (
            <div key="google" className="grid gap-1.5">
              {field("google_profil")}
              <label className="flex w-fit items-center gap-2 text-xs text-sbkm-navy dark:text-white/80">
                <input
                  type="checkbox"
                  className="size-3.5 accent-sbkm-navy"
                  checked={value.no_google_profile}
                  disabled={disabled}
                  onChange={(e) => props.onChange({ ...value, no_google_profile: e.target.checked })}
                />
                Kein Google-Profil
              </label>
              {props.googleNotFound && !value.no_google_profile && !value.fields.google_profil.trim() ? (
                <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">{GOOGLE_NOT_FOUND_HINT}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={row.join("-")} className={cn("grid gap-3", keys.length > 1 && "sm:grid-cols-2")}>
            {keys.map((key) => field(key))}
          </div>
        );
      })}

      <div className="grid gap-2 border-t border-sbkm-navy/8 pt-3 dark:border-white/8">
        {value.custom.map((item, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2">
            <input
              className={inputClass}
              value={item.label}
              disabled={disabled}
              maxLength={CONTACT_CUSTOM_LABEL_MAX}
              placeholder="Bezeichnung"
              aria-label="Bezeichnung des Felds"
              onChange={(e) =>
                props.onChange({ ...value, custom: value.custom.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)) })
              }
            />
            <input
              className={inputClass}
              value={item.value}
              disabled={disabled}
              maxLength={CONTACT_CUSTOM_VALUE_MAX}
              placeholder="Wert"
              aria-label="Wert des Felds"
              onChange={(e) =>
                props.onChange({ ...value, custom: value.custom.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)) })
              }
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => props.onChange({ ...value, custom: value.custom.filter((_, i) => i !== index) })}
              className="inline-flex size-8 items-center justify-center rounded-lg text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-500/10"
              aria-label="Feld entfernen"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        {value.custom.length < CONTACT_CUSTOM_FIELDS_MAX ? (
          <DtPillButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-fit px-2 text-xs"
            disabled={disabled}
            onClick={() => props.onChange({ ...value, custom: [...value.custom, { label: "", value: "" }] })}
          >
            <Plus className="size-3.5" aria-hidden />
            Feld hinzufügen
          </DtPillButton>
        ) : null}
      </div>
    </div>
  );
}
