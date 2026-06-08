"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, ChevronLeft, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { DtSelect } from "@/components/dt/dt-select";
import { cn } from "@/components/dt/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyAgentPreview } from "@/lib/dt/survey-to-agent-prompt";

type WizardStep = "organisation" | "regeln" | "vorschau" | "fertig";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export function SurveyToAgentWizard(props: {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  initialOrganisationId: string | null;
  organisations: Array<{ id: string; name: string }>;
}) {
  const needsOrg = !props.initialOrganisationId && props.organisations.length > 0;

  const [step, setStep] = useState<WizardStep>(
    needsOrg ? "organisation" : "regeln",
  );
  const [orgId, setOrgId] = useState(
    props.initialOrganisationId ?? props.organisations[0]?.id ?? "",
  );
  const [extraRules, setExtraRules] = useState("");
  const [preview, setPreview] = useState<SurveyAgentPreview | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  const orgName = useMemo(
    () => props.organisations.find((o) => o.id === orgId)?.name ?? "",
    [props.organisations, orgId],
  );

  const responseHref = `/dashboard/surveys/${props.surveyId}/responses/${props.responseId}`;

  const generatePreview = useCallback(async () => {
    if (!orgId) {
      setError("Bitte zuerst eine Organisation wählen.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/surveys/${props.surveyId}/responses/${props.responseId}/generate-agent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: orgId,
          extraRules: extraRules.trim() || undefined,
        }),
      },
    );
    const json = (await res.json()) as {
      ok?: boolean;
      preview?: SurveyAgentPreview;
      message?: string;
    };
    setLoading(false);
    if (!json.ok || !json.preview) {
      setError(json.message ?? "Generierung fehlgeschlagen.");
      return;
    }
    setPreview(json.preview);
    setStep("vorschau");
  }, [orgId, extraRules, props.surveyId, props.responseId]);

  const createAgent = useCallback(async () => {
    if (!preview || !orgId) return;
    setCreating(true);
    setError(null);
    const res = await fetch(
      `/api/surveys/${props.surveyId}/responses/${props.responseId}/create-agent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: orgId, agent: preview }),
      },
    );
    const json = (await res.json()) as {
      ok?: boolean;
      agentId?: string;
      message?: string;
    };
    setCreating(false);
    if (!json.ok || !json.agentId) {
      setError(json.message ?? "Agent konnte nicht angelegt werden.");
      return;
    }
    setCreatedAgentId(json.agentId);
    setStep("fertig");
  }, [preview, orgId, props.surveyId, props.responseId]);

  const startTestChat = useCallback(async () => {
    if (!createdAgentId || !orgId) return;
    const res = await fetch("/api/dt/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId: orgId,
        agentId: createdAgentId,
        mode: "default",
        title: `Test: ${preview?.name ?? "Persona"}`,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; chatId?: string };
    if (json.ok && json.chatId) {
      window.location.href = `/?org=${encodeURIComponent(orgId)}&chat=${encodeURIComponent(json.chatId)}`;
    }
  }, [createdAgentId, orgId, preview?.name]);

  const promptChars = preview?.prompt_template.trim().length ?? 0;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link
          href={responseHref}
          className="inline-flex w-fit items-center gap-1 text-sm text-secondary transition-colors hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Zurück zu Antwort-Details
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-6 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            In Agent umwandeln
          </h1>
        </div>
        <p className="text-sm text-secondary">
          {props.surveyTitle} — Persona aus Umfrage-Antworten generieren
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(needsOrg
          ? (["organisation", "regeln", "vorschau", "fertig"] as const)
          : (["regeln", "vorschau", "fertig"] as const)
        ).map((s) => (
          <Badge
            key={s}
            variant={step === s ? "default" : "outline"}
            className="capitalize"
          >
            {s === "organisation"
              ? "Organisation"
              : s === "regeln"
                ? "Regeln"
                : s === "vorschau"
                  ? "Vorschau"
                  : "Fertig"}
          </Badge>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {step === "organisation" ? (
        <Card>
          <CardHeader>
            <CardTitle>Organisation zuweisen</CardTitle>
            <CardDescription>
              Diese Umfrage ist noch keiner Organisation zugeordnet. Wähle die
              Ziel-Organisation für den neuen Agenten.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <DtSelect
              label="Organisation"
              value={orgId}
              onValueChange={setOrgId}
              options={props.organisations.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
              fullWidth
            />
            <Button
              type="button"
              disabled={!orgId}
              onClick={() => setStep("regeln")}
            >
              Weiter
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === "regeln" ? (
        <Card>
          <CardHeader>
            <CardTitle>Zusatzregeln & Generierung</CardTitle>
            <CardDescription>
              Optional: Ton, Schwerpunkte oder Tabus für die KI-Erstellung.
              {orgName ? ` Organisation: ${orgName}.` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!needsOrg && props.organisations.length > 1 ? (
              <DtSelect
                label="Organisation"
                value={orgId}
                onValueChange={setOrgId}
                options={props.organisations.map((o) => ({
                  value: o.id,
                  label: o.name,
                }))}
                fullWidth
              />
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="extra-rules">Extra Regeln (optional)</Label>
              <Textarea
                id="extra-rules"
                value={extraRules}
                onChange={(e) => setExtraRules(e.target.value)}
                placeholder="z. B. Fokus auf B2B-Einkäufer, sachlicher Ton, keine Preisdiskussion …"
                rows={5}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {needsOrg ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("organisation")}
                >
                  Zurück
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={loading || !orgId}
                onClick={() => void generatePreview()}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-4" aria-hidden />
                )}
                Agent-Vorschau generieren
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "regeln" && loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-muted/50"
            />
          ))}
        </div>
      ) : null}

      {step === "vorschau" && preview ? (
        <motion.div className="grid gap-4" variants={container} initial="hidden" animate="show">
          <motion.div variants={item}>
            <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
              <CardHeader>
                <CardTitle>Vorschau bearbeiten</CardTitle>
                <CardDescription>{preview.summary}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input
                    id="agent-name"
                    value={preview.name}
                    onChange={(e) =>
                      setPreview({ ...preview, name: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agent-slug">Slug</Label>
                  <Input
                    id="agent-slug"
                    value={preview.slug}
                    onChange={(e) =>
                      setPreview({
                        ...preview,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                      })
                    }
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="agent-role">Rolle</Label>
                  <Input
                    id="agent-role"
                    value={preview.role}
                    onChange={(e) =>
                      setPreview({ ...preview, role: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="agent-prompt">Persona-Prompt</Label>
                    <span className="text-xs tabular-nums text-secondary">
                      {promptChars.toLocaleString("de-DE")} Zeichen
                    </span>
                  </div>
                  <Textarea
                    id="agent-prompt"
                    value={preview.prompt_template}
                    onChange={(e) =>
                      setPreview({ ...preview, prompt_template: e.target.value })
                    }
                    className={cn(
                      "font-mono text-xs leading-relaxed",
                      promptExpanded ? "min-h-[480px]" : "max-h-64",
                    )}
                    rows={promptExpanded ? 24 : 12}
                  />
                  <button
                    type="button"
                    onClick={() => setPromptExpanded((v) => !v)}
                    className="text-left text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {promptExpanded ? "Weniger anzeigen" : "Vollständig anzeigen"}
                  </button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item} className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("regeln")}>
              Zurück
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void generatePreview()}
            >
              <RefreshCw className="size-4" aria-hidden />
              Regenerieren
            </Button>
            <Button type="button" disabled={creating} onClick={() => void createAgent()}>
              {creating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Agent anlegen
            </Button>
          </motion.div>
        </motion.div>
      ) : null}

      {step === "fertig" && createdAgentId ? (
        <Card>
          <CardHeader>
            <CardTitle>Agent erstellt</CardTitle>
            <CardDescription>
              {preview?.name ?? "Persona"} wurde für {orgName} angelegt.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link
                href={`/dashboard/verwaltung/agents?org=${encodeURIComponent(orgId)}`}
              >
                Agent bearbeiten
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link
                href={`/dashboard/verwaltung/agent-kontext?org=${encodeURIComponent(orgId)}&agent=${encodeURIComponent(createdAgentId)}&mode=default`}
              >
                Kontext ansehen
              </Link>
            </Button>
            <Button type="button" onClick={() => void startTestChat()}>
              Test-Chat starten
            </Button>
            <Button asChild variant="outline">
              <Link href={responseHref}>Zur Antwort</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
