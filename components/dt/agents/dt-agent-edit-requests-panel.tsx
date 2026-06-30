"use client";

import { Clock, XCircle } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import {
  formatAgentEditRequestStatus,
  type DtAgentEditRequestRow,
} from "@/lib/dt/agent-edit-requests";
import { cn } from "@/components/dt/cn";

function statusVariant(status: DtAgentEditRequestRow["status"]) {
  switch (status) {
    case "pending":
      return "secondary";
    case "approved":
      return "default";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function DtAgentEditRequestsPanel(props: {
  requests: DtAgentEditRequestRow[];
  agentsById: Map<string, { name: string }>;
  onCancel: (requestId: string) => Promise<void>;
  busy?: boolean;
}) {
  const visible = props.requests.filter((r) => r.status !== "cancelled").slice(0, 8);
  if (visible.length === 0) return null;

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-sbkm-ink-500" aria-hidden />
        <h2 className="text-sm font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
          Ihre Änderungsanfragen
        </h2>
      </div>
      <div className="grid gap-2">
        {visible.map((req) => {
          const agentName = props.agentsById.get(req.agent_id)?.name ?? "Agent";
          return (
            <DtGlassCard
              key={req.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 transition-all duration-200 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-sbkm-navy dark:text-white">
                    {agentName}
                  </p>
                  <Badge variant={statusVariant(req.status)}>
                    {formatAgentEditRequestStatus(req.status)}
                  </Badge>
                </div>
                <p className="tabular-nums text-xs text-sbkm-ink-600 dark:text-white/50">
                  {new Date(req.created_at).toLocaleString("de-DE")}
                </p>
                {req.reviewer_note && req.status === "rejected" ? (
                  <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                    Hinweis: {req.reviewer_note}
                  </p>
                ) : null}
              </div>
              {req.status === "pending" ? (
                <DtPillButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={props.busy}
                  className="gap-1.5"
                  onClick={() => void props.onCancel(req.id)}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Zurückziehen
                </DtPillButton>
              ) : null}
            </DtGlassCard>
          );
        })}
      </div>
    </section>
  );
}

export function DtAgentsReadOnlyBanner() {
  return (
    <div
      className={cn(
        "rounded-dt border border-sbkm-navy/10 bg-gradient-to-br from-white via-white to-sbkm-mint/[0.06] p-4",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]",
        "dark:border-white/10 dark:from-white/[0.04] dark:to-sbkm-mint/[0.08]",
      )}
    >
      <p className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
        Agenten werden von uns gepflegt
      </p>
      <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
        Sie können Agenten aus dem Marketplace aktivieren und Änderungswünsche einreichen. Wir prüfen
        jede Anfrage und setzen sie nach Freigabe um — in der Regel innerhalb von 1–2 Werktagen.
      </p>
    </div>
  );
}
