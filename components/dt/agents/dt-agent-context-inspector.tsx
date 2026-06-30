"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  FileSearch,
  RefreshCw,
} from "lucide-react";

import { DtSelect } from "@/components/dt/dt-select";
import { DtTabs } from "@/components/dt/dt-tabs";
import { cn } from "@/components/dt/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  DtAgentContextBundle,
  DtAgentContextMode,
  DtAgentContextSection,
  DtAgentContextSourceType,
} from "@/lib/dt/agent-context-inspector";
import { estimateSectionChars } from "@/lib/dt/agent-context-inspector";

type AgentOption = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  slug?: string;
  is_enabled?: boolean;
};

const SOURCE_BADGE: Record<DtAgentContextSourceType, string> = {
  system: "System",
  agent: "Agent",
  organisation: "Organisation",
  user: "Deine Regeln",
  crawl: "Crawl",
  report: "Report",
  analytics: "Analytics",
  tasks: "Aufgaben",
  dynamic: "Dynamisch",
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

function ContextSectionCard(props: {
  section: DtAgentContextSection;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [expanded, setExpanded] = useState(false);
  const chars = estimateSectionChars(props.section.content);

  return (
    <motion.div
      variants={item}
      className="relative overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/20"
        aria-expanded={open}
      >
        <div className="min-w-0 grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-primary">
              {props.section.title}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {SOURCE_BADGE[props.section.sourceType]}
            </Badge>
            {props.section.isEmpty ? (
              <Badge variant="secondary" className="text-[10px]">
                Leer
              </Badge>
            ) : (
              <span className="text-xs tabular-nums text-secondary">
                {chars.toLocaleString("de-DE")} Zeichen
              </span>
            )}
          </div>
          <p className="text-xs text-secondary">{props.section.description}</p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-secondary transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-t border-border/60 px-4 pb-4 pt-3">
          {props.section.isEmpty ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-center">
              <p className="text-sm text-secondary">
                Kein Inhalt für diesen Abschnitt.
              </p>
              {props.section.editHref ? (
                <Button asChild size="sm" variant="secondary" className="mt-3">
                  <Link href={props.section.editHref}>Quelle bearbeiten</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <pre
                className={cn(
                  "scrollbar-subtle overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed text-primary",
                  expanded ? "max-h-none" : "max-h-64 overflow-y-auto",
                )}
              >
                {props.section.content}
              </pre>
              {chars > 800 ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {expanded ? "Weniger anzeigen" : "Vollständig anzeigen"}
                </button>
              ) : null}
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-secondary">
              Quelle: {props.section.sourceLabel}
            </span>
            {props.section.editHref ? (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link href={props.section.editHref}>
                  Bearbeiten
                  <ExternalLink className="size-3" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}

export function DtAgentContextInspector(props: {
  organisations: Array<{ id: string; name: string }>;
  initialOrgId: string;
  initialAgentId?: string | null;
  initialMode?: DtAgentContextMode;
  isPlatformAdmin?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [orgId, setOrgId] = useState(
    () => searchParams.get("org") ?? props.initialOrgId,
  );
  const [mode, setMode] = useState<DtAgentContextMode>(() => {
    const m = searchParams.get("mode");
    if (m === "seo" && !props.isPlatformAdmin) return "default";
    return m === "seo" || m === "team" ? m : (props.initialMode ?? "default");
  });
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState(
    () => searchParams.get("agent") ?? props.initialAgentId ?? "",
  );
  const [bundle, setBundle] = useState<DtAgentContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = searchParams.get("org");
    if (
      fromUrl &&
      props.organisations.some((organisation) => organisation.id === fromUrl) &&
      fromUrl !== orgId
    ) {
      setOrgId(fromUrl);
    }
  }, [searchParams, props.organisations, orgId]);

  const syncUrl = useCallback(
    (patch: { org?: string; agent?: string; mode?: DtAgentContextMode }) => {
      const nextOrg = patch.org ?? orgId;
      const nextAgent = patch.agent ?? agentId;
      const nextMode = patch.mode ?? mode;
      const q = new URLSearchParams();
      q.set("org", nextOrg);
      if (nextAgent) q.set("agent", nextAgent);
      q.set("mode", nextMode);
      router.replace(`/dashboard/verwaltung/agent-kontext?${q.toString()}`, {
        scroll: false,
      });
    },
    [orgId, agentId, mode, router],
  );

  const loadAgents = useCallback(async (oid: string) => {
    const res = await fetch(
      `/api/dt/agents/manage?org=${encodeURIComponent(oid)}`,
    );
    const json = (await res.json()) as {
      ok?: boolean;
      agents?: AgentOption[];
    };
    if (json.ok && json.agents) {
      setAgents(json.agents);
      return json.agents;
    }
    setAgents([]);
    return [];
  }, []);

  const loadBundle = useCallback(async () => {
    if (!orgId || !agentId) return;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({
      org: orgId,
      agent: agentId,
      mode,
    });
    const res = await fetch(`/api/dt/agents/context?${q}`);
    const json = (await res.json()) as {
      ok?: boolean;
      bundle?: DtAgentContextBundle;
      message?: string;
    };
    setLoading(false);
    if (!json.ok || !json.bundle) {
      setError(json.message ?? "Kontext konnte nicht geladen werden.");
      setBundle(null);
      return;
    }
    setBundle(json.bundle);
  }, [orgId, agentId, mode]);

  useEffect(() => {
    void (async () => {
      const list = await loadAgents(orgId);
      setAgentId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        const fromUrl = searchParams.get("agent");
        if (fromUrl && list.some((a) => a.id === fromUrl)) return fromUrl;
        if (mode === "seo") {
          const seoAgent = list.find(
            (a) => a.slug === "seo_advisor" || a.kind === "geo_advisor",
          );
          if (seoAgent) return seoAgent.id;
        }
        return list[0]?.id ?? "";
      });
    })();
  }, [orgId, loadAgents, searchParams, mode]);

  useEffect(() => {
    if (agentId) void loadBundle();
  }, [agentId, loadBundle]);

  const sectionCount = bundle?.sections.length ?? 0;
  const filledSections = useMemo(
    () => bundle?.sections.filter((s) => !s.isEmpty).length ?? 0,
    [bundle],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <FileSearch className="size-5 text-primary" aria-hidden />
            <h1 className="text-2xl font-bold tracking-tight text-primary">
              Agent-Kontext
            </h1>
          </div>
          <p className="text-sm text-secondary">
            Alles, was in den System-Prompt fließt — ohne Chat-Verlauf.
          </p>
        </div>
        {bundle ? (
          <Badge variant="secondary" className="tabular-nums">
            {filledSections}/{sectionCount} Abschnitte ·{" "}
            {bundle.assembledPreviewChars.toLocaleString("de-DE")} Zeichen
          </Badge>
        ) : null}
      </div>

      <div className="rounded-xl border border-sbkm-navy/10 bg-sbkm-mint/10 px-4 py-3 text-sm text-sbkm-navy dark:border-white/10 dark:bg-white/[0.06] dark:text-white/85">
        <p className="font-medium">Nicht enthalten</p>
        <p className="mt-1 text-xs text-secondary dark:text-white/60">
          Chat-Verlauf, Nachrichten-Anhänge und dynamisch eingefügte URL-Inhalte
          aus einzelnen Nachrichten. Der SEO-Report und Crawl-Daten sind
          enthalten, sobald sie vorliegen.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-1">
        <DtSelect
          label="Agent"
          value={agentId}
          onValueChange={(id) => {
            setAgentId(id);
            syncUrl({ agent: id });
          }}
          options={agents.map((a) => ({
            value: a.id,
            label:
              a.is_enabled === false ? `${a.name} (deaktiviert)` : a.name,
            description: a.role ?? a.kind,
          }))}
          fullWidth
          disabled={agents.length === 0}
          placeholder="Agent wählen"
        />
      </div>

      <DtTabs
        className="mb-0"
        layoutId="agent-context-mode-tab"
        tabs={[
          { id: "default", label: "Standard" },
          ...(props.isPlatformAdmin ? [{ id: "seo" as const, label: "SEO" }] : []),
          { id: "team", label: "Team" },
        ]}
        active={mode}
        onChange={(id) => {
          const next = id as DtAgentContextMode;
          setMode(next);
          syncUrl({ mode: next });
        }}
      />

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-muted/50"
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <AlertCircle className="size-8 text-destructive" aria-hidden />
          <p className="text-sm font-medium text-primary">{error}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void loadBundle()}
          >
            <RefreshCw className="size-4" aria-hidden />
            Erneut laden
          </Button>
        </div>
      ) : bundle ? (
        <motion.div
          className="grid gap-3"
          variants={container}
          initial="hidden"
          animate="show"
          key={`${bundle.organisationId}-${bundle.agentId}-${bundle.mode}`}
        >
          {bundle.sections.map((section, index) => (
            <ContextSectionCard
              key={section.id}
              section={section}
              defaultOpen={index < 2}
            />
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}
