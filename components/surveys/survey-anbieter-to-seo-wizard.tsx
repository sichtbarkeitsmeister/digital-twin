"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type OrgOption = { id: string; name: string };

type Props = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  initialOrganisationId: string | null;
  organisations: OrgOption[];
};

export function SurveyAnbieterToSeoWizard(props: Props) {
  const [orgId, setOrgId] = useState(props.initialOrganisationId ?? "");
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
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        knowledgeBody?: string;
      } | null;
      if (!json?.ok || !json.knowledgeBody) {
        setError(json?.message ?? "Vorschau fehlgeschlagen.");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when org changes
  }, [orgId]);

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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
            Anbieter-Wissen übernommen
          </CardTitle>
          <CardDescription>
            Die Fragebogen-Antworten liegen jetzt 1:1 in den „Zusätzlichen Anweisungen“ des
            SEO-Beraters von {done.organisationName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link
              href={`/dashboard/verwaltung/agents?org=${encodeURIComponent(done.organisationId)}`}
            >
              SEO-Berater öffnen
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dashboard/surveys/${props.surveyId}/responses/${props.responseId}`}>
              Zurück zur Antwort
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm text-secondary">
          <Link
            href={`/dashboard/surveys/${props.surveyId}/responses/${props.responseId}`}
            className="hover:text-primary transition-colors"
          >
            ← Zurück
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">In SEO-Berater übernehmen</h1>
        <p className="mt-1 text-sm text-secondary">
          Anbieter-Fragebogen „{props.surveyTitle}“ — kein Avatar, nur Unternehmenswissen (1:1).
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" aria-hidden />
            Organisation
          </CardTitle>
          <CardDescription>
            Der SEO-Berater dieser Organisation erhält die Fragebogen-Daten unter „Zusätzliche
            Anweisungen“.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="anbieter-org">Organisation</Label>
            <select
              id="anbieter-org"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Bitte wählen…</option>
              {props.organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!orgId || loading}
              onClick={() => void loadPreview()}
            >
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Vorschau aktualisieren
            </Button>
            <Button type="button" disabled={!orgId || !preview || applying} onClick={() => void apply()}>
              {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              In SEO-Berater speichern
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wissens-Vorschau (1:1)</CardTitle>
          <CardDescription>
            So landen die Daten im SEO-Berater — ohne KI-Umschreibung.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !preview ? (
            <p className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Vorschau wird geladen…
            </p>
          ) : preview ? (
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
              {preview}
            </pre>
          ) : (
            <p className="text-sm text-secondary">Organisation wählen, um die Vorschau zu sehen.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
