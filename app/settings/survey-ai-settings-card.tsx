"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getSurveyAiAutoNavigateDefault,
  getSurveyAiShowArchivedDefault,
} from "@/lib/settings/survey-ai";
import { SURVEY_AI_MAX_ASSISTANT_RULES_CHARS } from "@/lib/settings/survey-ai-server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type PrefsResponse = {
  ok: boolean;
  preferences?: {
    autoNavigate: boolean;
    showArchivedChats: boolean;
    globalAssistantRules: string;
  };
  message?: string;
};

export function SurveyAiSettingsCard() {
  const [autoNavigate, setAutoNavigate] = useState(getSurveyAiAutoNavigateDefault());
  const [showArchived, setShowArchived] = useState(getSurveyAiShowArchivedDefault());
  const [globalRules, setGlobalRules] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const rulesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patchPreferences = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/settings/survey-ai", {
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
      setAutoNavigate(data.preferences.autoNavigate);
      setShowArchived(data.preferences.showArchivedChats);
      setGlobalRules(data.preferences.globalAssistantRules);
    }
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/settings/survey-ai", { cache: "no-store" });
      const data = (await res.json()) as PrefsResponse;
      if (cancelled) return;
      if (!res.ok || !data.ok || !data.preferences) {
        setLoadError(data.message ?? "Einstellungen konnten nicht geladen werden.");
        setPrefsReady(true);
        return;
      }
      setAutoNavigate(data.preferences.autoNavigate);
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
    <Card id="survey-ai-settings">
      <CardHeader>
        <CardTitle>Survey KI</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
        {!prefsReady ? <p className="text-xs text-secondary">Lade…</p> : null}

        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={autoNavigate}
            disabled={!prefsReady}
            onCheckedChange={(next) => {
              const enabled = next === true;
              setAutoNavigate(enabled);
              void patchPreferences({ autoNavigate: enabled });
            }}
          />
          <span className="grid gap-1">
            <span className="font-medium">Automatisch zur betroffenen Umfrage navigieren</span>
            <span className="text-xs text-secondary">
              Wenn aktiv, öffnet der KI-Assistent nach Erstellen/Bearbeiten direkt die entsprechende Umfrage.
            </span>
          </span>
        </label>

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
            <span className="font-medium">Archivierte KI-Chats anzeigen</span>
            <span className="text-xs text-secondary">
              Steuert, ob archivierte Chats standardmäßig in der Chat-Liste sichtbar sind.
            </span>
          </span>
        </label>

        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="survey-ai-global-rules">
            Globale KI-Regeln
          </label>
          <p className="text-xs text-secondary">
            Gelten für alle Survey-KI-Chats. Die KI befolgt sie, soweit sie mit technischen Vorgaben (z. B.
            JSON im Aktionsmodus) vereinbar sind.
          </p>
          <Textarea
            id="survey-ai-global-rules"
            disabled={!prefsReady}
            value={globalRules}
            maxLength={SURVEY_AI_MAX_ASSISTANT_RULES_CHARS}
            onChange={(e) => {
              const v = e.target.value;
              setGlobalRules(v);
              scheduleRulesSave(v);
            }}
            placeholder="z. B. Immer mit „Hallo“ antworten; nur Du-Form; …"
            className="min-h-[100px] resize-y text-sm"
          />
          <p className="text-xs text-secondary text-right">
            {globalRules.length}/{SURVEY_AI_MAX_ASSISTANT_RULES_CHARS}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
