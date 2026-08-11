"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Building2, CheckCircle2, ChevronLeft, Loader2 } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";

type OrgOption = { id: string; name: string };

type Props = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  initialOrganisationId: string | null;
  organisations: OrgOption[];
};

export function SurveyAnbieterToSeoWizard(props: Props) {
  const [orgId, setOrgId] = useState(
    props.initialOrganisationId ?? props.organisations[0]?.id ?? "",
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    agentId: string;
    organisationId: string;
    organisationName: string;
  } | null>(null);

  const loadPreview = useCallback(async () => {
    if (!orgId) {
      setError("Bitte zuerst eine Organisation wählen.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/surveys/${props.surveyId}/responses/${props.responseId}/apply-to-seo`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organisationId: orgId, action: "preview" }),
        },
      );
      const rawText = await res.text();
      let json: { ok?: boolean; message?: string; knowledgeBody?: string } | null = null;
      try {
        json = JSON.parse(rawText) as {
          ok?: boolean;
          message?: string;
          knowledgeBody?: string;
        };
      } catch {
        setError(
          res.ok
            ? "Vorschau fehlgeschlagen (ungültige Server-Antwort)."
            : `Vorschau fehlgeschlagen (HTTP ${res.status}).`,
        );
        setPreview(null);
        return;
      }
      if (!json?.ok) {
        setError(json?.message?.trim() || `Vorschau fehlgeschlagen (HTTP ${res.status}).`);
        setPreview(null);
        return;
      }
      if (!json.knowledgeBody?.trim()) {
        setError("Vorschau leer — im Fragebogen wurden keine Antworten gefunden.");
        setPreview(null);
        return;
      }
      setPreview(json.knowledgeBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vorschau fehlgeschlagen.");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, props.surveyId, props.responseId]);

  useEffect(() => {
    if (orgId) void loadPreview();
  }, [orgId, loadPreview]);

  async function apply() {
    if (!orgId) {
      setError("Bitte zuerst eine Organisation wählen.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/surveys/${props.surveyId}/responses/${props.responseId}/apply-to-seo`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organisationId: orgId, action: "apply" }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        agentId?: string;
        organisationId?: string;
        organisationName?: string;
      } | null;
      if (!json?.ok || !json.agentId || !json.organisationId) {
        setError(json?.message ?? "Übernahme fehlgeschlagen.");
        return;
      }
      setDone({
        agentId: json.agentId,
        organisationId: json.organisationId,
        organisationName: json.organisationName ?? "Organisation",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Übernahme fehlgeschlagen.");
    } finally {
      setApplying(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto grid max-w-3xl gap-6">
        <DtGlassCard variant="solid" className="grid gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/20 text-sbkm-navy dark:text-sbkm-mint">
              <CheckCircle2 className="size-5" aria-hidden />
            </div>
            <div className="grid gap-1">
              <h1 className="text-xl font-bold tracking-tight text-sbkm-navy dark:text-white">
                Anbieter-Wissen übernommen
              </h1>
              <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
                Die Fragebogen-Antworten liegen jetzt 1:1 in den „Zusätzlichen Anweisungen“ des
                SEO-Beraters von {done.organisationName}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <DtPillButton asChild variant="mint" size="sm">
              <Link
                href={`/dashboard/verwaltung/agents?org=${encodeURIComponent(done.organisationId)}`}
              >
                SEO-Berater öffnen
              </Link>
            </DtPillButton>
            <DtPillButton asChild variant="outline" size="sm">
              <Link href={`/dashboard/surveys/${props.surveyId}/responses/${props.responseId}`}>
                Zurück zur Antwort
              </Link>
            </DtPillButton>
          </div>
        </DtGlassCard>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="grid gap-2">
        <Link
          href={`/dashboard/surveys/${props.surveyId}/responses/${props.responseId}`}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-sbkm-ink-600 transition-colors hover:text-sbkm-navy dark:text-white/55 dark:hover:text-white"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Zurück
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
          In SEO-Berater übernehmen
        </h1>
        <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
          Anbieter-Fragebogen „{props.surveyTitle}“ — kein Avatar, nur Unternehmenswissen (1:1).
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <DtGlassCard variant="solid" className="grid gap-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint">
            <Building2 className="size-5" aria-hidden />
          </div>
          <div className="grid gap-1">
            <h2 className="text-base font-bold text-sbkm-navy dark:text-white">Organisation</h2>
            <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
              Der SEO-Berater dieser Organisation erhält die Fragebogen-Daten unter „Zusätzliche
              Anweisungen“.
            </p>
          </div>
        </div>

        <DtSelect
          label="Organisation"
          fullWidth
          elevated
          menuMaxHeight="max-h-72"
          value={orgId}
          onValueChange={(value) => {
            setOrgId(value);
            setPreview(null);
          }}
          options={props.organisations.map((o) => ({ value: o.id, label: o.name }))}
          placeholder="Organisation wählen …"
        />

        <div className="flex flex-wrap gap-2">
          <DtPillButton
            type="button"
            variant="outline"
            size="sm"
            disabled={!orgId || loading}
            onClick={() => void loadPreview()}
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Vorschau aktualisieren
          </DtPillButton>
          <DtPillButton
            type="button"
            variant="mint"
            size="sm"
            disabled={!orgId || !preview || applying}
            onClick={() => void apply()}
          >
            {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            In SEO-Berater speichern
          </DtPillButton>
        </div>
      </DtGlassCard>

      <DtGlassCard variant="subtle" className="grid gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sbkm-navy/5 text-sbkm-navy dark:bg-white/10 dark:text-white">
            <BookOpen className="size-5" aria-hidden />
          </div>
          <div className="grid gap-1">
            <h2 className="text-base font-bold text-sbkm-navy dark:text-white">
              Wissens-Vorschau (1:1)
            </h2>
            <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
              Unternehmensfakten als Thema + Inhalt — ohne fact-IDs und ohne KI-Umschreibung.
            </p>
          </div>
        </div>

        {loading && !preview ? (
          <p className="flex items-center gap-2 text-sm text-sbkm-ink-600 dark:text-white/55">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Vorschau wird geladen…
          </p>
        ) : preview ? (
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-sbkm-navy/10 bg-white/70 p-4 text-xs leading-relaxed text-sbkm-navy shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-white/85">
            {preview}
          </pre>
        ) : (
          <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
            Organisation wählen, um die Vorschau zu sehen.
          </p>
        )}
      </DtGlassCard>
    </div>
  );
}
