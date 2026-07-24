"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";

import { DtSelect } from "@/components/dt/dt-select";
import { cn } from "@/components/dt/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyAgentPreview } from "@/lib/dt/survey-to-agent-prompt";
import type { SurveyAgentRefinePreview } from "@/lib/dt/survey-refine-agent-prompt";

type WizardMode = "create" | "refine";
type WizardStep = "organisation" | "modus" | "regeln" | "vorschau" | "fertig";

type OrgAgentOption = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  slug: string;
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

function agentKindLabel(kind: string): string {
  if (kind === "seo_advisor") return "SEO";
  if (kind === "persona") return "Persona";
  return kind.replace(/_/g, " ");
}

export function SurveyToAgentWizard(props: {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  initialOrganisationId: string | null;
  organisations: Array<{ id: string; name: string }>;
}) {
  const needsOrg = !props.initialOrganisationId && props.organisations.length > 0;

  const [step, setStep] = useState<WizardStep>(
    needsOrg ? "organisation" : "modus",
  );
  const [wizardMode, setWizardMode] = useState<WizardMode>("create");
  const [orgId, setOrgId] = useState(
    props.initialOrganisationId ?? props.organisations[0]?.id ?? "",
  );
  const [agentId, setAgentId] = useState("");
  const [orgAgents, setOrgAgents] = useState<OrgAgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [extraRules, setExtraRules] = useState("");
  const [preview, setPreview] = useState<SurveyAgentPreview | null>(null);
  const [refinePreview, setRefinePreview] = useState<SurveyAgentRefinePreview | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [usesGlobalPrompt, setUsesGlobalPrompt] = useState(false);
  const [refineAgent, setRefineAgent] = useState<OrgAgentOption | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [currentPromptOpen, setCurrentPromptOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  const orgName = useMemo(
    () => props.organisations.find((o) => o.id === orgId)?.name ?? "",
    [props.organisations, orgId],
  );

  const responseHref = `/dashboard/surveys/${props.surveyId}/responses/${props.responseId}`;

  const stepBadges = useMemo(() => {
    const steps: WizardStep[] = needsOrg
      ? ["organisation", "modus", "regeln", "vorschau", "fertig"]
      : ["modus", "regeln", "vorschau", "fertig"];
    return steps;
  }, [needsOrg]);

  useEffect(() => {
    if (wizardMode !== "refine" || !orgId) {
      setOrgAgents([]);
      setAgentId("");
      return;
    }

    let cancelled = false;
    setAgentsLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/dt/agents?org=${encodeURIComponent(orgId)}`);
        const json = (await res.json()) as {
          ok?: boolean;
          agents?: Array<{
            id: string;
            name: string;
            role: string | null;
            kind: string;
            slug: string;
          }>;
        };
        if (cancelled) return;
        const agents = json.ok && json.agents ? json.agents : [];
        setOrgAgents(agents);
        setAgentId((prev) =>
          prev && agents.some((a) => a.id === prev) ? prev : (agents[0]?.id ?? ""),
        );
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wizardMode, orgId]);

  const generatePreview = useCallback(async () => {
    if (!orgId) {
      setError("Bitte zuerst eine Organisation wählen.");
      return;
    }
    if (wizardMode === "refine" && !agentId) {
      setError("Bitte einen Agenten wählen.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Under API maxDuration (300s); fail with a clear message instead of hanging forever.
      const res = await fetch(
        `/api/surveys/${props.surveyId}/responses/${props.responseId}/generate-agent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organisationId: orgId,
            extraRules: extraRules.trim() || undefined,
            mode: wizardMode,
            agentId: wizardMode === "refine" ? agentId : undefined,
          }),
          signal: AbortSignal.timeout(780_000),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        mode?: WizardMode;
        preview?: SurveyAgentPreview;
        refinement?: SurveyAgentRefinePreview;
        currentPrompt?: string;
        usesGlobalPrompt?: boolean;
        agent?: OrgAgentOption;
        message?: string;
      } | null;

      if (!json?.ok) {
        setError(json?.message ?? "Generierung fehlgeschlagen.");
        return;
      }

      if (json.mode === "refine" && json.refinement) {
        setRefinePreview(json.refinement);
        setCurrentPrompt(json.currentPrompt ?? "");
        setUsesGlobalPrompt(Boolean(json.usesGlobalPrompt));
        setRefineAgent(json.agent ?? null);
        setPreview(null);
      } else if (json.preview) {
        setPreview(json.preview);
        setRefinePreview(null);
        setCurrentPrompt("");
        setRefineAgent(null);
      } else {
        setError("Generierung fehlgeschlagen.");
        return;
      }

      setStep("vorschau");
    } catch (err) {
      const aborted =
        err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
      setError(
        aborted
          ? "Die Generierung hat das Zeitlimit überschritten. Bitte erneut versuchen — der nächste Deploy nutzt ein schnelleres Modell."
          : err instanceof Error
            ? err.message
            : "Generierung fehlgeschlagen.",
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, agentId, wizardMode, extraRules, props.surveyId, props.responseId]);

  const createAgent = useCallback(async () => {
    if (!orgId) return;

    if (wizardMode === "create") {
      if (!preview) return;
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
      return;
    }

    if (!refinePreview || !agentId) return;
    setCreating(true);
    setError(null);
    const res = await fetch(
      `/api/surveys/${props.surveyId}/responses/${props.responseId}/refine-agent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: orgId,
          agentId,
          promptTemplate: refinePreview.prompt_template,
        }),
      },
    );
    const json = (await res.json()) as {
      ok?: boolean;
      agentId?: string;
      message?: string;
    };
    setCreating(false);
    if (!json.ok || !json.agentId) {
      setError(json.message ?? "Agent konnte nicht aktualisiert werden.");
      return;
    }
    setCreatedAgentId(json.agentId);
    setStep("fertig");
  }, [
    wizardMode,
    preview,
    refinePreview,
    orgId,
    agentId,
    props.surveyId,
    props.responseId,
  ]);

  const startTestChat = useCallback(async () => {
    if (!createdAgentId || !orgId) return;
    const res = await fetch("/api/dt/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId: orgId,
        agentId: createdAgentId,
        mode: "default",
        title:
          wizardMode === "refine"
            ? `Test: ${refineAgent?.name ?? "Agent"}`
            : `Test: ${preview?.name ?? "Persona"}`,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; chatId?: string };
    if (json.ok && json.chatId) {
      window.location.href = `/?org=${encodeURIComponent(orgId)}&chat=${encodeURIComponent(json.chatId)}`;
    }
  }, [createdAgentId, orgId, wizardMode, refineAgent?.name, preview?.name]);

  const activePrompt =
    wizardMode === "refine"
      ? (refinePreview?.prompt_template ?? "")
      : (preview?.prompt_template ?? "");
  const promptChars = activePrompt.trim().length;

  const goToRegeln = () => {
    setPreview(null);
    setRefinePreview(null);
    setStep("regeln");
  };

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
          {props.surveyTitle} — Persona erstellen oder bestehenden Agenten verfeinern
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {stepBadges.map((s) => (
          <Badge
            key={s}
            variant={step === s ? "default" : "outline"}
            className="capitalize"
          >
            {s === "organisation"
              ? "Organisation"
              : s === "modus"
                ? "Modus"
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
              Ziel-Organisation.
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
            <Button type="button" disabled={!orgId} onClick={() => setStep("modus")}>
              Weiter
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === "modus" ? (
        <Card>
          <CardHeader>
            <CardTitle>Was möchtest du tun?</CardTitle>
            <CardDescription>
              Neuen Persona-Agenten anlegen oder Umfrage-Erkenntnisse in einen
              vorhandenen Agenten einarbeiten.
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

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setWizardMode("create")}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  wizardMode === "create"
                    ? "border-sbkm-mint bg-sbkm-mint/10"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4" aria-hidden />
                  <span className="font-semibold text-primary">Neuen Agent erstellen</span>
                </div>
                <p className="mt-2 text-sm text-secondary">
                  Neue Persona aus der Umfrage generieren — wie bisher.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setWizardMode("refine")}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  wizardMode === "refine"
                    ? "border-sbkm-mint bg-sbkm-mint/10"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <Wand2 className="size-4" aria-hidden />
                  <span className="font-semibold text-primary">
                    Bestehenden Agent verfeinern
                  </span>
                </div>
                <p className="mt-2 text-sm text-secondary">
                  Umfrage in einen vorhandenen Prompt einarbeiten — z. B. SEO-Advisor.
                </p>
              </button>
            </div>

            {wizardMode === "refine" ? (
              <div className="grid gap-2">
                {agentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-secondary">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Agenten werden geladen…
                  </div>
                ) : orgAgents.length === 0 ? (
                  <p className="text-sm text-secondary">
                    Keine Agenten in dieser Organisation gefunden.
                  </p>
                ) : (
                  <DtSelect
                    label="Ziel-Agent"
                    value={agentId}
                    onValueChange={setAgentId}
                    options={orgAgents.map((agent) => ({
                      value: agent.id,
                      label: agent.name,
                      description: [agent.role, agentKindLabel(agent.kind)]
                        .filter(Boolean)
                        .join(" · "),
                    }))}
                    fullWidth
                  />
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {needsOrg ? (
                <Button type="button" variant="outline" onClick={() => setStep("organisation")}>
                  Zurück
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!orgId || (wizardMode === "refine" && (!agentId || agentsLoading))}
                onClick={() => setStep("regeln")}
              >
                Weiter
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "regeln" ? (
        <Card>
          <CardHeader>
            <CardTitle>Zusatzregeln & Generierung</CardTitle>
            <CardDescription>
              Optional: Ton, Schwerpunkte oder Tabus für die KI.
              {orgName ? ` Organisation: ${orgName}.` : null}
              {wizardMode === "refine" && refineAgent
                ? ` Agent: ${refineAgent.name}.`
                : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
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
              <Button type="button" variant="outline" onClick={() => setStep("modus")}>
                Zurück
              </Button>
              <Button
                type="button"
                disabled={loading || !orgId || (wizardMode === "refine" && !agentId)}
                onClick={() => void generatePreview()}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-4" aria-hidden />
                )}
                {wizardMode === "refine" ? "Verfeinerung generieren" : "Agent-Vorschau generieren"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "regeln" && loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : null}

      {step === "vorschau" && wizardMode === "create" && preview ? (
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
                    onChange={(e) => setPreview({ ...preview, name: e.target.value })}
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
                    onChange={(e) => setPreview({ ...preview, role: e.target.value })}
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
            <Button type="button" variant="outline" onClick={goToRegeln}>
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
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Agent anlegen
            </Button>
          </motion.div>
        </motion.div>
      ) : null}

      {step === "vorschau" && wizardMode === "refine" && refinePreview ? (
        <motion.div className="grid gap-4" variants={container} initial="hidden" animate="show">
          <motion.div variants={item}>
            <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
              <CardHeader>
                <CardTitle>
                  Verfeinerung für {refineAgent?.name ?? "Agent"}
                </CardTitle>
                <CardDescription>{refinePreview.summary}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {usesGlobalPrompt ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                    Dieser Agent nutzte einen globalen Basis-Prompt. Beim Übernehmen wird
                    der organisations-spezifische Prompt aktualisiert und die globale
                    Synchronisation deaktiviert.
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {refinePreview.changed_sections.map((section) => (
                    <Badge key={section} variant="secondary">
                      {section}
                    </Badge>
                  ))}
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="refined-prompt">Verfeinerter Prompt</Label>
                    <span className="text-xs tabular-nums text-secondary">
                      {promptChars.toLocaleString("de-DE")} Zeichen
                    </span>
                  </div>
                  <Textarea
                    id="refined-prompt"
                    value={refinePreview.prompt_template}
                    onChange={(e) =>
                      setRefinePreview({
                        ...refinePreview,
                        prompt_template: e.target.value,
                      })
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

                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPromptOpen((v) => !v)}
                    className="flex items-center gap-2 text-sm font-medium text-secondary hover:text-primary"
                  >
                    {currentPromptOpen ? (
                      <ChevronUp className="size-4" aria-hidden />
                    ) : (
                      <ChevronDown className="size-4" aria-hidden />
                    )}
                    Aktueller Prompt zum Vergleich
                  </button>
                  {currentPromptOpen ? (
                    <Textarea
                      readOnly
                      value={currentPrompt}
                      className="max-h-48 font-mono text-xs leading-relaxed text-secondary"
                      rows={10}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item} className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={goToRegeln}>
              Zurück
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void generatePreview()}
            >
              <RefreshCw className="size-4" aria-hidden />
              Neu generieren
            </Button>
            <Button type="button" disabled={creating} onClick={() => void createAgent()}>
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Agent aktualisieren
            </Button>
          </motion.div>
        </motion.div>
      ) : null}

      {step === "fertig" && createdAgentId ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {wizardMode === "refine" ? "Agent aktualisiert" : "Agent erstellt"}
            </CardTitle>
            <CardDescription>
              {wizardMode === "refine"
                ? `${refineAgent?.name ?? "Agent"} wurde mit den Umfrage-Erkenntnissen verfeinert.`
                : `${preview?.name ?? "Persona"} wurde für ${orgName} angelegt.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={`/dashboard/verwaltung/agents?org=${encodeURIComponent(orgId)}`}>
                Agent bearbeiten
              </Link>
            </Button>
            {wizardMode === "create" ? (
              <>
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
              </>
            ) : null}
            <Button asChild variant="outline">
              <Link href={responseHref}>Zur Antwort</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
