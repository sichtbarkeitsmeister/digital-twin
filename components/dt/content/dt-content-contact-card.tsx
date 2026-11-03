"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Globe, Loader2, MapPin, Save } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtContactDataFields } from "@/components/dt/contact/dt-contact-data-fields";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import {
  CONTACT_FIELD_KEYS,
  contactFormState,
  isProtectedContactSource,
  type ContactFormState,
} from "@/lib/dt/contact-data";
import { formatContentDate, formatEur } from "@/lib/dt/content/presentation";
import type { ContentContactActionResult, ContentContactResult } from "@/lib/dt/content/types";

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

function sameForm(a: ContactFormState, b: ContactFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * „Kontaktdaten“ in Texte, right under „Seitenquelle“: the organisation's contact data, the same
 * as in the Firmenprofil. Filled from the crawl right away (no confirmation), editable; edited
 * fields become „manuell“ and the crawl never overwrites them. Every step that needs them reads
 * them fresh: SEO, Faktencheck, GEO, Hormozi and the Endabnahme.
 */
export function DtContentContactCard(props: { organisationId: string; refreshKey?: number }) {
  const { organisationId } = props;
  const [result, setResult] = useState<ContentContactResult | null>(null);
  const [form, setForm] = useState<ContactFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "refill" | "google" | null>(null);
  const [open, setOpen] = useState(false);

  const apply = useCallback((next: ContentContactResult) => {
    setResult(next);
    setForm(contactFormState(next.contact));
    setError(null);
  }, []);

  const load = useCallback(async () => {
    const res = await contentApi<ContentContactResult>(`/api/dt/content/contact?${contentQuery(organisationId)}`);
    if (res.ok) {
      apply(res.data);
      const filled = CONTACT_FIELD_KEYS.filter((key) => res.data.contact.fields[key]?.value.trim()).length;
      if (filled === 0) setOpen(true);
    } else {
      setError(res.message);
    }
  }, [organisationId, apply]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  const initial = useMemo(() => (result ? contactFormState(result.contact) : null), [result]);
  const dirty = Boolean(form && initial && !sameForm(form, initial));

  const summary = useMemo(() => {
    if (!result) return null;
    const fields = CONTACT_FIELD_KEYS.map((key) => result.contact.fields[key]).filter((f) => f?.value.trim());
    const crawl = fields.filter((f) => f!.source === "crawl").length;
    const search = fields.filter((f) => f!.source === "websuche").length;
    const manual = fields.filter((f) => isProtectedContactSource(f!.source)).length;
    return [
      `${fields.length} von ${CONTACT_FIELD_KEYS.length} Feldern ausgefüllt`,
      crawl ? `${crawl} aus Crawl` : "",
      search ? `${search} aus Websuche – bitte prüfen` : "",
      manual ? `${manual} manuell` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }, [result]);

  async function save() {
    if (!form) return;
    setBusy("save");
    const res = await contentApi<ContentContactResult>("/api/dt/content/contact", {
      method: "PUT",
      body: { organisationId, fields: form.fields, custom: form.custom, no_google_profile: form.no_google_profile },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    apply(res.data);
    toast.success("Kontaktdaten gespeichert – gilt ab dem nächsten Schritt.");
  }

  async function action(kind: "refill" | "google") {
    if (dirty && !window.confirm("Ungespeicherte Änderungen gehen verloren. Trotzdem fortfahren?")) return;
    setBusy(kind);
    const res = await contentApi<ContentContactActionResult>(`/api/dt/content/contact/${kind}`, {
      method: "POST",
      body: { organisationId },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    apply(res.data);
    setOpen(true);
    if (res.data.changed.length > 0) toast.success(res.data.message);
    else toast.message(res.data.message);
  }

  const google = result?.contact.google_search ?? null;
  const googleNotFound = Boolean(google && google.status !== "found");

  return (
    <section aria-label="Kontaktdaten" className={cardClass}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45"
          aria-expanded={open}
        >
          <MapPin className="size-4 shrink-0 text-sbkm-mint" aria-hidden />
          <span className="grid min-w-0">
            <span className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Kontaktdaten</span>
            <span className="truncate text-xs text-sbkm-ink-600 dark:text-white/60">
              {error ?? summary ?? "Wird geladen …"}
            </span>
          </span>
          <ChevronDown className={cn("ml-auto size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </header>
      {open && result && form ? (
        <div className="grid gap-4 px-4 py-4 sm:px-5">
          <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
            Gleiche Daten wie im Firmenprofil. Alles ist freiwillig. Was hier steht, gilt in den Texten als bestätigt
            (SEO, Faktencheck, GEO, Hormozi, Endabnahme). Geänderte Felder zählen als manuell und werden von Crawl und
            Websuche nie überschrieben.
          </p>
          <DtContactDataFields
            stored={result.contact}
            value={form}
            onChange={setForm}
            disabled={busy != null}
            googleNotFound={googleNotFound}
          />
          {google ? (
            <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
              Google-Suche am {formatContentDate(google.at)}:{" "}
              {google.status === "found"
                ? "Profil gefunden"
                : google.status === "error"
                  ? `fehlgeschlagen (${google.reason ?? "unbekannt"})`
                  : (google.reason ?? "nicht gefunden")}
              {google.cost_eur > 0 ? ` · ${formatEur(google.cost_eur)}` : ""}
            </p>
          ) : null}
          {result.contact.crawl_fill ? (
            <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
              Zuletzt aus der Website gefüllt am {formatContentDate(result.contact.crawl_fill.at)}
              {result.contact.crawl_fill.pages.length > 0 ? ` (${result.contact.crawl_fill.pages.join(", ")})` : ""}
              {result.contact.crawl_fill.cost_eur > 0 ? ` · ${formatEur(result.contact.crawl_fill.cost_eur)}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <DtPillButton type="button" size="sm" disabled={!dirty || busy != null} onClick={() => void save()}>
              {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
              Speichern
            </DtPillButton>
            {result.crawl_available ? (
              <DtPillButton
                type="button"
                size="sm"
                variant="outline"
                disabled={busy != null}
                onClick={() => void action("refill")}
                title="Impressum, Kontakt und Startseite der gecrawlten Website neu lesen; manuelle Angaben bleiben"
              >
                {busy === "refill" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Globe className="size-3.5" aria-hidden />}
                Aus Website neu füllen
              </DtPillButton>
            ) : null}
            {!result.google_blocked ? (
              <DtPillButton
                type="button"
                size="sm"
                variant="outline"
                disabled={busy != null || dirty}
                onClick={() => void action("google")}
                title="Websuche nach dem Google-Unternehmensprofil (Firmenname und Ort), höchstens 3 Suchen"
              >
                {busy === "google" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <MapPin className="size-3.5" aria-hidden />}
                Google-Profil suchen
              </DtPillButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
