"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type {
  DtAgentEditRequestView,
  DtAgentProposedChanges,
} from "@/lib/dt/agent-edit-requests";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  role: "Rolle",
  prompt_template: "Prompt",
  quick_actions: "Schnellaktionen",
  is_enabled: "Aktiv",
  position: "Reihenfolge",
};

function formatChangeValue(key: string, value: unknown): string {
  if (key === "quick_actions" && Array.isArray(value)) return value.join(", ");
  if (key === "is_enabled") return value ? "Ja" : "Nein";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DtAgentChangesDiff(props: { changes: DtAgentProposedChanges }) {
  const entries = Object.entries(props.changes);
  if (entries.length === 0) {
    return <p className="text-sm text-sbkm-ink-600">Keine Felder geändert.</p>;
  }

  return (
    <ul className="grid gap-2 text-sm">
      {entries.map(([key, value]) => (
        <li
          key={key}
          className="rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/5"
        >
          <span className="font-semibold text-sbkm-navy dark:text-white">
            {FIELD_LABELS[key] ?? key}
          </span>
          <p className="mt-0.5 break-words text-sbkm-ink-600 dark:text-white/65">
            {formatChangeValue(key, value)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function DtAgentEditRequestsAdmin() {
  const [requests, setRequests] = useState<DtAgentEditRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/dt/agents/edit-requests?pending=1");
    const json = (await res.json()) as {
      ok?: boolean;
      requests?: DtAgentEditRequestView[];
    };
    if (json.ok && json.requests) setRequests(json.requests);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = useMemo(
    () => requests.find((r) => r.id === reviewId) ?? null,
    [requests, reviewId],
  );

  async function decide(decision: "approve" | "reject") {
    if (!reviewId) return;
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/dt/agents/edit-requests/${reviewId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reviewerNote: reviewerNote.trim() || undefined }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Fehler.");
      return;
    }
    setStatus(json.message ?? "Erledigt.");
    setReviewId(null);
    setReviewerNote("");
    await refresh();
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
          Agent-Änderungsanfragen
        </h1>
        <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
          Organisationen schlagen Anpassungen vor — hier freigeben oder ablehnen.
        </p>
      </div>

      {status ? (
        <p className="text-sm font-medium text-sbkm-mint" role="status">
          {status}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-sbkm-ink-600">Lade offene Anfragen…</p>
      ) : requests.length === 0 ? (
        <DtGlassCard className="p-8 text-center">
          <p className="font-semibold text-sbkm-navy dark:text-white">Alles erledigt</p>
          <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
            Keine offenen Agent-Änderungsanfragen.
          </p>
        </DtGlassCard>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }}
          className="grid gap-3"
        >
          {requests.map((req) => (
            <motion.div
              key={req.id}
              variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
            >
              <DtGlassCard className="flex flex-wrap items-center justify-between gap-3 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sbkm-navy dark:text-white">
                      {req.agent_name ?? "Agent"}
                    </p>
                    <Badge variant="secondary">{req.organisation_name ?? "Organisation"}</Badge>
                  </div>
                  <p className="text-xs text-sbkm-ink-600 dark:text-white/50">
                    {req.agent_slug} ·{" "}
                    <span className="tabular-nums">
                      {new Date(req.created_at).toLocaleString("de-DE")}
                    </span>
                  </p>
                  {req.request_note ? (
                    <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
                      „{req.request_note}"
                    </p>
                  ) : null}
                </div>
                <DtPillButton type="button" onClick={() => setReviewId(req.id)}>
                  Prüfen
                </DtPillButton>
              </DtGlassCard>
            </motion.div>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {active ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-sbkm-navy/50 p-4 backdrop-blur-sm"
            onClick={() => !busy && setReviewId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-dt border border-sbkm-navy/10 bg-white p-6 shadow-dt-lg dark:border-white/10 dark:bg-sbkm-navy"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white">
                {active.agent_name}
              </h2>
              <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
                {active.organisation_name}
              </p>

              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sbkm-ink-500">
                  Vorgeschlagene Änderungen
                </p>
                <DtAgentChangesDiff changes={active.proposed_changes} />
              </div>

              <label className="mt-4 grid gap-1 text-sm">
                <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
                  Hinweis bei Ablehnung (optional)
                </span>
                <Textarea
                  value={reviewerNote}
                  disabled={busy}
                  onChange={(e) => setReviewerNote(e.target.value)}
                  className="min-h-[72px] text-sm"
                  placeholder="Kurze Begründung für den Kunden …"
                />
              </label>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <DtPillButton
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setReviewId(null)}
                >
                  Schließen
                </DtPillButton>
                <DtPillButton
                  type="button"
                  variant="outline"
                  disabled={busy}
                  className="gap-1.5"
                  onClick={() => void decide("reject")}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  Ablehnen
                </DtPillButton>
                <DtPillButton
                  type="button"
                  disabled={busy}
                  className="gap-1.5"
                  onClick={() => void decide("approve")}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Übernehmen
                </DtPillButton>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
