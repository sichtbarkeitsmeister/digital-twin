"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DT_MAX_ASSISTANT_RULES_CHARS } from "@/lib/settings/dt-user-preferences-server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type PrefsResponse = {
  ok: boolean;
  preferences?: {
    showArchivedChats: boolean;
    globalAssistantRules: string;
  };
  message?: string;
};

export function DtSettingsCard(props: {
  /** Platform-admin-only controls such as global assistant rules. */
  showInternalSettings?: boolean;
}) {
  const showInternal = Boolean(props.showInternalSettings);
  const [showArchived, setShowArchived] = useState(false);
  const [globalRules, setGlobalRules] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const rulesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patchPreferences = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/dt/user-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as PrefsResponse;
    if (!res.ok || !data.ok) {
      setLoadError(data.message ?? "Speichern fehlgeschlagen.");
      return false;
    }
    setLoadError(null);
    if (data.preferences) {
      setShowArchived(data.preferences.showArchivedChats);
      setGlobalRules(data.preferences.globalAssistantRules);
    }
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/dt/user-preferences", { cache: "no-store" });
      const data = (await res.json()) as PrefsResponse;
      if (cancelled) return;
      if (!res.ok || !data.ok || !data.preferences) {
        setLoadError(data.message ?? "Einstellungen konnten nicht geladen werden.");
        setPrefsReady(true);
        return;
      }
      setShowArchived(data.preferences.showArchivedChats);
      setGlobalRules(data.preferences.globalAssistantRules);
      setPrefsReady(true);
      setLoadError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function scheduleRulesSave(next: string) {
    if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
    rulesDebounceRef.current = setTimeout(() => {
      rulesDebounceRef.current = null;
      void patchPreferences({ globalAssistantRules: next });
    }, 450);
  }

  useEffect(() => {
    return () => {
      if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
    };
  }, []);

  return (
    <Card id="digital-twin-settings">
      <CardHeader>
        <CardTitle>DigitalTwin</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
        {!prefsReady ? <p className="text-xs text-secondary">Lade…</p> : null}

        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={showArchived}
            disabled={!prefsReady}
            onCheckedChange={(next) => {
              const enabled = next === true;
              setShowArchived(enabled);
              void patchPreferences({ showArchivedChats: enabled });
            }}
          />
          <span className="grid gap-1">
            <span className="font-medium">Archivierte Chats anzeigen</span>
            <span className="text-xs text-secondary">
              Standard in der DigitalTwin-Chat-Liste (Startseite und Dashboard).
            </span>
          </span>
        </label>

        {showInternal ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="dt-global-rules">
              Globale Assistenten-Regeln
            </label>
            <p className="text-xs text-secondary">
              Gelten für alle DigitalTwin-Chats deiner Organisationen. Die KI befolgt sie, soweit mit
              den Systemanweisungen vereinbar.
            </p>
            <Textarea
              id="dt-global-rules"
              disabled={!prefsReady}
              value={globalRules}
              maxLength={DT_MAX_ASSISTANT_RULES_CHARS}
              onChange={(e) => {
                const v = e.target.value;
                setGlobalRules(v);
                scheduleRulesSave(v);
              }}
              placeholder="z. B. Immer auf Deutsch; kurze Antworten; Du-Form; …"
              className="min-h-[100px] resize-y text-sm"
            />
            <p className="text-right text-xs text-secondary">
              {globalRules.length}/{DT_MAX_ASSISTANT_RULES_CHARS}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
