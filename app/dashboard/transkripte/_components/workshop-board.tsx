"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const WORKSHOP_CHANGED_EVENT = "dt-workshop-changed";

type SectionStatus = "empty" | "proposed" | "approved" | "stale";

type WorkshopSourceView = {
  id: string;
  title: string | null;
  filename: string | null;
  sourceKind: "raw" | "summary";
  spokenOn: string | null;
  createdAt: string;
  hasSummary: boolean;
};

type AnbieterItem = {
  key: string;
  label: string;
  current: string;
  earlier: string | null;
  sources: string;
};

type AnbieterState = {
  status: SectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  items: AnbieterItem[];
};

type AvatarCase = {
  service: string;
  summary: string;
  quotes: string[];
};

type WorkshopAvatar = {
  key: string;
  title: string;
  whySeparate: string;
  cases: AvatarCase[];
  dossier: {
    narrative: string;
    pains: string;
    outcome: string;
    quotes: string[];
    gaps: string[];
  } | null;
  preview: {
    name: string;
    role: string;
    summary: string;
    promptAppend: string;
  } | null;
  agentId: string | null;
};

type AvatarPlan = {
  status: SectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  notWanted: string;
  avatars: WorkshopAvatar[];
};

function formatSpoken(iso: string | null): string {
  if (!iso) return "ohne Datum";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function statusLabel(status: SectionStatus): string {
  switch (status) {
    case "approved":
      return "Freigegeben";
    case "proposed":
      return "Wartet auf Freigabe";
    case "stale":
      return "Bestand hat sich geändert";
    default:
      return "Noch offen";
  }
}

function statusBadge(status: SectionStatus) {
  if (status === "approved") return <Badge>Freigegeben</Badge>;
  if (status === "stale") return <Badge variant="destructive">Veraltet</Badge>;
  if (status === "proposed") return <Badge variant="secondary">Zur Freigabe</Badge>;
  return <Badge variant="outline">Offen</Badge>;
}

export function WorkshopBoard(props: { organisationId: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<WorkshopSourceView[]>([]);
  const [anbieter, setAnbieter] = useState<AnbieterState | null>(null);
  const [avatarPlan, setAvatarPlan] = useState<AvatarPlan | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [notWanted, setNotWanted] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/dt/workshop?org=${encodeURIComponent(props.organisationId)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        sources?: WorkshopSourceView[];
        anbieter?: AnbieterState;
        avatarPlan?: AvatarPlan;
      };
      if (!res.ok || !json.ok || !json.anbieter || !json.avatarPlan) {
        setError(json.message ?? "Workshop konnte nicht geladen werden.");
        return;
      }
      setSources(json.sources ?? []);
      setAnbieter(json.anbieter);
      setAvatarPlan(json.avatarPlan);
      setTitles(
        Object.fromEntries(json.avatarPlan.avatars.map((avatar) => [avatar.key, avatar.title])),
      );
      setNotWanted(json.avatarPlan.notWanted);
    } catch {
      setError("Workshop konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [props.organisationId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ organisationId?: string }>).detail;
      if (detail?.organisationId && detail.organisationId !== props.organisationId) return;
      void refresh();
    }
    window.addEventListener(WORKSHOP_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(WORKSHOP_CHANGED_EVENT, onChanged);
  }, [props.organisationId, refresh]);

  async function postAnbieter(action: "evaluate" | "approve") {
    setBusy(action === "evaluate" ? "anbieter-evaluate" : "anbieter-approve");
    try {
      const res = await fetch("/api/dt/workshop/anbieter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, action }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; anbieter?: AnbieterState };
      if (!res.ok || !json.ok || !json.anbieter) {
        toast.error(json.message ?? "Anbieter-Schritt fehlgeschlagen.");
        return;
      }
      setAnbieter(json.anbieter);
      toast.success(
        action === "evaluate"
          ? "Anbieterstand liegt vor. Bitte prüfen und freigeben."
          : "Freigegeben. Der SEO-Berater hat den aktuellen Stand.",
      );
    } catch {
      toast.error("Anbieter-Schritt fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  async function postAvatars(body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/dt/workshop/avatars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, ...body }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; avatarPlan?: AvatarPlan };
      if (!res.ok || !json.ok || !json.avatarPlan) {
        toast.error(json.message ?? "Avatar-Schritt fehlgeschlagen.");
        return;
      }
      setAvatarPlan(json.avatarPlan);
      setTitles(
        Object.fromEntries(json.avatarPlan.avatars.map((avatar) => [avatar.key, avatar.title])),
      );
      setNotWanted(json.avatarPlan.notWanted);
      toast.success(success);
    } catch {
      toast.error("Avatar-Schritt fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  const planEditable = avatarPlan?.status === "proposed";

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bestand</CardTitle>
          <CardDescription>
            Alle Gespräche dieser Organisation, in Gesprächsreihenfolge. Eine spätere Aussage zum
            selben Punkt ersetzt die frühere. Die frühere bleibt hier sichtbar.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Lade Bestand…
            </p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-secondary">
              Noch kein Gespräch. Oben ein Rohtranskript oder eine Zusammenfassung speichern.
            </p>
          ) : (
            <ol className="grid gap-2">
              {sources.map((source, index) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-center gap-2 text-sm text-primary"
                >
                  <span className="text-xs text-secondary">{index + 1}.</span>
                  <span className="font-medium">{formatSpoken(source.spokenOn)}</span>
                  <span>{source.title || source.filename || "Ohne Titel"}</span>
                  <Badge variant="outline">
                    {source.sourceKind === "summary" ? "Zusammenfassung" : "Rohtranskript"}
                  </Badge>
                  {source.hasSummary ? (
                    <span className="text-xs text-secondary">Zusammenfassung liegt vor</span>
                  ) : (
                    <span className="text-xs text-secondary">Noch ohne Zusammenfassung</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">1. Anbieter</CardTitle>
            {anbieter ? statusBadge(anbieter.status) : null}
          </div>
          <CardDescription>
            Zwölf Punkte aus dem gesamten Bestand. Freigabe schreibt nur den aktuellen Stand in den
            SEO-Berater. Offene Punkte bleiben offen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading || sources.length === 0 || busy != null}
              onClick={() => void postAnbieter("evaluate")}
            >
              {busy === "anbieter-evaluate" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {anbieter && anbieter.status !== "empty" ? "Bestand neu auswerten" : "Bestand auswerten"}
            </Button>
            <Button
              type="button"
              disabled={anbieter?.status !== "proposed" || busy != null}
              onClick={() => void postAnbieter("approve")}
            >
              {busy === "anbieter-approve" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              {anbieter?.approvedFingerprint ? "Erneut freigeben" : "Freigeben und in den SEO-Berater schreiben"}
            </Button>
          </div>
          {anbieter?.status === "stale" ? (
            <p className="text-sm text-destructive">
              Seit der letzten Auswertung ist ein Gespräch dazugekommen oder geändert worden. Der
              SEO-Berater behält den alten Stand, bis du neu auswertest und erneut freigibst.
            </p>
          ) : null}
          {anbieter?.status === "approved" ? (
            <p className="text-sm text-secondary">
              Dieser Stand ist freigegeben und im SEO-Berater gespeichert.
            </p>
          ) : null}
          {anbieter && anbieter.status !== "empty" ? (
            <ul className="grid gap-3">
              {anbieter.items.map((item) => (
                <li
                  key={item.key}
                  className="rounded-xl border border-sbkm-navy/10 px-3 py-3 dark:border-white/10"
                >
                  <p className="text-sm font-semibold text-primary">{item.label}</p>
                  {item.current ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-primary">{item.current}</p>
                  ) : (
                    <p className="mt-1 text-sm text-secondary">Offen. Wird nicht erfunden.</p>
                  )}
                  {item.earlier ? (
                    <p className="mt-2 text-xs text-secondary">
                      Zuerst: {item.earlier}
                      {item.sources ? ` · ${item.sources}` : ""}
                    </p>
                  ) : item.sources ? (
                    <p className="mt-2 text-xs text-secondary">{item.sources}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">{statusLabel(anbieter?.status ?? "empty")}.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">2. Avatar-Plan</CardTitle>
            {avatarPlan ? statusBadge(avatarPlan.status) : null}
          </div>
          <CardDescription>
            Wie viele Avatare, Arbeitstitel, und wen ihr nicht als Kunden wollt. Fälle sind Belege,
            keine eigenen Avatare. Ohne freigegebenen Plan entsteht kein Avatar-Text.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading || sources.length === 0 || busy != null}
              onClick={() =>
                void postAvatars({ action: "plan" }, "plan", "Avatar-Plan liegt vor. Bitte prüfen.")
              }
            >
              {busy === "plan" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {avatarPlan && avatarPlan.avatars.length > 0 ? "Plan neu vorschlagen" : "Avatar-Plan vorschlagen"}
            </Button>
            <Button
              type="button"
              disabled={!planEditable || busy != null}
              onClick={() =>
                void postAvatars(
                  {
                    action: "approve",
                    notWanted,
                    titles: (avatarPlan?.avatars ?? []).map((avatar) => ({
                      key: avatar.key,
                      title: (titles[avatar.key] ?? avatar.title).trim(),
                    })),
                  },
                  "approve",
                  "Avatar-Plan freigegeben. Jetzt Avatar für Avatar.",
                )
              }
            >
              {busy === "approve" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              Plan freigeben
            </Button>
          </div>
          {avatarPlan?.status === "stale" ? (
            <p className="text-sm text-destructive">
              Der Bestand hat sich geändert. Bereits angelegte Avatare bleiben. Nur der Punkt, den
              ein neues Gespräch trifft, wird neu vorgeschlagen und braucht wieder eine Freigabe.
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <p className="text-sm font-medium text-primary">Nicht als Kunden gewollt</p>
            <Textarea
              value={notWanted}
              onChange={(event) => setNotWanted(event.target.value)}
              readOnly={!planEditable}
              placeholder="Wird kein Avatar."
              className="min-h-[72px]"
            />
          </div>
          {avatarPlan && avatarPlan.avatars.length > 0 ? (
            <ul className="grid gap-4">
              {avatarPlan.avatars.map((avatar, index) => (
                <li
                  key={avatar.key}
                  className="grid gap-3 rounded-xl border border-sbkm-navy/10 px-3 py-3 dark:border-white/10"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-secondary">Avatar {index + 1}</span>
                    {avatar.agentId ? <Badge variant="secondary">Agent vorhanden</Badge> : null}
                  </div>
                  {planEditable ? (
                    <Input
                      value={titles[avatar.key] ?? avatar.title}
                      onChange={(event) =>
                        setTitles((prev) => ({ ...prev, [avatar.key]: event.target.value }))
                      }
                      aria-label={`Arbeitstitel Avatar ${index + 1}`}
                    />
                  ) : (
                    <p className="text-sm font-semibold text-primary">{avatar.title}</p>
                  )}
                  {avatar.whySeparate ? (
                    <p className="text-sm text-secondary">{avatar.whySeparate}</p>
                  ) : null}
                  {avatar.cases.length > 0 ? (
                    <ul className="grid gap-2">
                      {avatar.cases.map((item, caseIndex) => (
                        <li key={`${avatar.key}-${caseIndex}`} className="text-sm">
                          <p className="font-medium text-primary">
                            {item.service || "Fall"}: {item.summary}
                          </p>
                          {item.quotes.length > 0 ? (
                            <p className="text-xs text-secondary">„{item.quotes.join("“ · „")}“</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {avatarPlan.status === "approved" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy != null}
                        onClick={() =>
                          void postAvatars(
                            { action: "dossier", avatarKey: avatar.key },
                            `dossier:${avatar.key}`,
                            "Akte liegt vor.",
                          )
                        }
                      >
                        {busy === `dossier:${avatar.key}` ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        Akte
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy != null || !avatar.dossier}
                        onClick={() =>
                          void postAvatars(
                            { action: "preview", avatarKey: avatar.key },
                            `preview:${avatar.key}`,
                            "Vorschau liegt vor.",
                          )
                        }
                      >
                        {busy === `preview:${avatar.key}` ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        Vorschau
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy != null || !avatar.preview}
                        onClick={() =>
                          void postAvatars(
                            { action: "create", avatarKey: avatar.key },
                            `create:${avatar.key}`,
                            avatar.agentId ? "Avatar aktualisiert." : "Avatar angelegt.",
                          )
                        }
                      >
                        {busy === `create:${avatar.key}` ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        {avatar.agentId ? "Agent aktualisieren" : "Agent anlegen"}
                      </Button>
                    </div>
                  ) : null}
                  {avatar.dossier ? (
                    <div className="grid gap-1 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Akte</p>
                      <p className="whitespace-pre-wrap">{avatar.dossier.narrative}</p>
                      {avatar.dossier.pains ? <p>Schmerz: {avatar.dossier.pains}</p> : null}
                      {avatar.dossier.outcome ? <p>Ergebnis: {avatar.dossier.outcome}</p> : null}
                      {avatar.dossier.quotes.length > 0 ? (
                        <p className="text-xs text-secondary">„{avatar.dossier.quotes.join("“ · „")}“</p>
                      ) : null}
                      {avatar.dossier.gaps.length > 0 ? (
                        <p className="text-xs text-secondary">Offen: {avatar.dossier.gaps.join(" · ")}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {avatar.preview ? (
                    <div className="grid gap-1 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                        Vorschau
                      </p>
                      <p className="font-medium">
                        {avatar.preview.name}
                        {avatar.preview.role ? ` · ${avatar.preview.role}` : ""}
                      </p>
                      <p>{avatar.preview.summary}</p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-sans text-[13px] leading-relaxed">
                        {avatar.preview.promptAppend}
                      </pre>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">Noch kein Avatar-Plan.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
