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
  quick_actions: "Schnelltests",
  is_enabled: "Aktiv",
  position: "Reihenfolge",
};

function proposedChangeLabels(changes: DtAgentProposedChanges): string {
  return Object.keys(changes)
    .map((field) => FIELD_LABELS[field] ?? field)
    .join(" · ");
}

function DtAgentChangeValue(props: { field: string; value: unknown }) {
  if (props.field === "quick_actions" && Array.isArray(props.value)) {
    const items = props.value.map((item) => String(item).trim()).filter(Boolean);
    if (items.length === 0) {
      return <p className="mt-0.5 text-sbkm-ink-600 dark:text-white/65">—</p>;
    }
    return (
      <ol className="mt-1.5 list-decimal space-y-2 pl-5 text-sbkm-ink-600 dark:text-white/65">
        {items.map((item, index) => (
          <li key={`${index}-${item.slice(0, 32)}`} className="break-words leading-relaxed">
            {item}
          </li>
        ))}
      </ol>
    );
  }

  if (props.field === "is_enabled") {
    return (
      <p className="mt-0.5 break-words text-sbkm-ink-600 dark:text-white/65">
        {props.value ? "Ja" : "Nein"}
      </p>
    );
  }

  if (props.value === null || props.value === undefined || props.value === "") {
    return <p className="mt-0.5 text-sbkm-ink-600 dark:text-white/65">—</p>;
  }

  return (
    <p className="mt-0.5 whitespace-pre-wrap break-words text-sbkm-ink-600 dark:text-white/65">
      {String(props.value)}
    </p>
  );
}

function DtAgentChangesDiff(props: { changes: DtAgentProposedChanges }) {
  const entries = Object.entries(props.changes);
  if (entries.length === 0) {
    return <p className="text-sm text-sbkm-ink-600">Keine Felder geändert.</p>;
  }

  return (
    <ul className="grid gap-2 text-sm">
      {entries.map(([field, value]) => (
        <li
          key={field}
          className="rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/5"
        >
          <span className="font-semibold text-sbkm-navy dark:text-white">
            {FIELD_LABELS[field] ?? field}
          </span>
          <DtAgentChangeValue field={field} value={value} />
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
                  {Object.keys(req.proposed_changes).length > 0 ? (
                    <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
                      {proposedChangeLabels(req.proposed_changes)}
                    </p>
                  ) : null}
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
            className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-sbkm-navy/50 backdrop-blur-sm"
            onClick={() => !busy && setReviewId(null)}
          >
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="agent-review-title"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.18 }}
                className="flex max-h-[min(90dvh,calc(100dvh-2rem))] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-dt border border-sbkm-navy/10 bg-white shadow-dt-lg dark:border-white/10 dark:bg-sbkm-navy"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 border-b border-sbkm-navy/10 px-6 py-4 dark:border-white/10">
                  <h2
                    id="agent-review-title"
                    className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white"
                  >
                    {active.agent_name}
                  </h2>
                  <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
                    {active.organisation_name}
                  </p>
                  {active.request_note ? (
                    <p className="mt-2 text-sm text-sbkm-ink-600 dark:text-white/60">
                      „{active.request_note}"
                    </p>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 scrollbar-subtle">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sbkm-ink-500">
                    Vorgeschlagene Änderungen
                  </p>
                  <DtAgentChangesDiff changes={active.proposed_changes} />

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
                </div>

                <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-sbkm-navy/10 px-6 py-4 dark:border-white/10">
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
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
