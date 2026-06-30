"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info, Loader2, Send, X } from "lucide-react";

import {
  DtAgentFormFields,
  agentFormValuesFromRow,
  quickActionsFromForm,
  type DtAgentFormValues,
} from "@/components/dt/agents/dt-agent-form-fields";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Textarea } from "@/components/ui/textarea";

type AgentRow = {
  id: string;
  name: string;
  role: string | null;
  prompt_template: string;
  quick_actions: unknown;
  is_enabled: boolean;
  position: number;
};

export function DtAgentEditRequestModal(props: {
  open: boolean;
  agent: AgentRow | null;
  organisationId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [values, setValues] = useState<DtAgentFormValues | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (props.open && props.agent) {
      setValues(agentFormValuesFromRow(props.agent));
      setRequestNote("");
      setError(null);
      setSuccess(null);
    } else if (!props.open) {
      setValues(null);
    }
  }, [props.open, props.agent]);

  const handleClose = () => {
    if (busy) return;
    props.onClose();
  };

  async function submit() {
    if (!props.agent || !values) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    const res = await fetch("/api/dt/agents/edit-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: props.organisationId,
        agentId: props.agent.id,
        name: values.name.trim(),
        role: values.role.trim() || null,
        promptTemplate: values.prompt,
        quickActions: quickActionsFromForm(values.quick),
        isEnabled: values.enabled,
        position: values.position,
        requestNote: requestNote.trim() || undefined,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setBusy(false);

    if (!json.ok) {
      setError(json.message ?? "Senden fehlgeschlagen.");
      return;
    }

    setSuccess(json.message ?? "Anfrage gesendet.");
    props.onSubmitted();
    setTimeout(() => props.onClose(), 1200);
  }

  return (
    <AnimatePresence>
      {props.open && props.agent && values ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center bg-sbkm-navy/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-request-title"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-dt border border-sbkm-navy/10 bg-white shadow-dt-lg dark:border-white/10 dark:bg-sbkm-navy sm:rounded-dt"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-sbkm-navy/10 px-5 py-4 dark:border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    id="agent-request-title"
                    className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white"
                  >
                    Änderung vorschlagen
                  </h2>
                  <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/55">
                    {props.agent.name} — wir prüfen Ihre Anfrage und setzen sie nach Freigabe um.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Schließen"
                  disabled={busy}
                  onClick={handleClose}
                  className="rounded-full p-1.5 text-sbkm-ink-500 transition hover:bg-sbkm-navy/5 dark:hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex gap-2 rounded-dt border border-sbkm-mint/25 bg-sbkm-mint/10 px-3 py-2 text-xs text-sbkm-navy dark:text-white/80">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sbkm-mint" aria-hidden />
                <span>
                  Sie können Marketplace-Agenten aktivieren. Anpassungen am Verhalten laufen über uns —
                  so bleibt die Qualität für alle Nutzer gleich hoch.
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DtAgentFormFields
                values={values}
                onChange={(patch) => setValues((prev) => (prev ? { ...prev, ...patch } : prev))}
                disabled={busy}
              />
              <label className="mt-4 grid gap-1 text-sm">
                <span className="font-semibold text-sbkm-ink-600 dark:text-white/55">
                  Nachricht an uns (optional)
                </span>
                <Textarea
                  value={requestNote}
                  disabled={busy}
                  onChange={(e) => setRequestNote(e.target.value)}
                  className="min-h-[72px] text-sm"
                  placeholder="z. B. Ton soll freundlicher werden, Fokus auf B2B-Leads …"
                />
              </label>
              {error ? (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
              {success ? (
                <p className="mt-3 text-sm font-medium text-sbkm-mint" role="status">
                  {success}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-sbkm-navy/10 px-5 py-4 dark:border-white/10">
              <button
                type="button"
                disabled={busy}
                onClick={handleClose}
                className="rounded-pill px-4 py-2 text-sm font-medium text-sbkm-ink-600 hover:bg-sbkm-navy/5 dark:text-white/60"
              >
                Abbrechen
              </button>
              <DtPillButton type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Senden…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Anfrage senden
                  </span>
                )}
              </DtPillButton>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
