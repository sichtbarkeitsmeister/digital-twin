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
import { AVATAR_VALUE_FIELDS, type AvatarValueKey } from "@/lib/dt/transcripts/avatar-value";

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
  dossier:
    | ({
        narrative: string;
        quotes: string[];
        gaps: string[];
      } & Record<AvatarValueKey, string>)
    | null;
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
  const [anbieterError, setAnbieterError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

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

  async function postJson<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; json: T } | { ok: false; message: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 280_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
      if (!res.ok || !json?.ok) {
        return { ok: false, message: json?.message ?? "Der Schritt ist fehlgeschlagen." };
      }
      return { ok: true, json };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          message: "Die Anfrage hat zu lange gedauert und wurde abgebrochen. Bitte erneut versuchen.",
        };
      }
      return { ok: false, message: "Der Schritt ist fehlgeschlagen. Bitte erneut versuchen." };
    } finally {
      clearTimeout(timer);
    }
  }

  async function postAnbieter(action: "evaluate" | "approve") {
    setBusy(action === "evaluate" ? "anbieter-evaluate" : "anbieter-approve");
    setAnbieterError(null);
    try {
      const result = await postJson<{ anbieter?: AnbieterState }>("/api/dt/workshop/anbieter", {
        organisationId: props.organisationId,
        action,
      });
      if (!result.ok) {
        setAnbieterError(result.message);
        toast.error(result.message);
        return;
      }
      if (!result.json.anbieter) {
        const message = "Die Auswertung hat keinen Stand zurückgegeben.";
        setAnbieterError(message);
        toast.error(message);
        return;
      }
      if (action === "evaluate" && result.json.anbieter.status === "empty") {
        const message =
          "Die Auswertung hat keinen belegten Punkt geliefert. Die Freigabe bleibt deshalb gesperrt.";
        setAnbieterError(message);
        toast.error(message);
        return;
      }
      setAnbieter(result.json.anbieter);
      toast.success(
        action === "evaluate"
          ? "Anbieterstand liegt vor. Bitte prüfen und freigeben."
          : "Freigegeben. Der SEO-Berater hat den aktuellen Stand.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function postAvatars(body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey);
    setAvatarError(null);
    try {
      const result = await postJson<{ avatarPlan?: AvatarPlan }>("/api/dt/workshop/avatars", {
        organisationId: props.organisationId,
        ...body,
      });
      if (!result.ok) {
        setAvatarError(result.message);
        toast.error(result.message);
        return;
      }
      if (!result.json.avatarPlan) {
        const message = "Der Avatar-Schritt hat nichts zurückgegeben.";
        setAvatarError(message);
        toast.error(message);
        return;
      }
      setAvatarPlan(result.json.avatarPlan);
      setTitles(
        Object.fromEntries(result.json.avatarPlan.avatars.map((avatar) => [avatar.key, avatar.title])),
      );
      setNotWanted(result.json.avatarPlan.notWanted);
      toast.success(success);
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
            Jeder Punkt aus dem gesamten Wortlaut, inklusive Ablauf und Mitwirkung. Jede Angabe
            bleibt erhalten. Freigabe schreibt nur den aktuellen Stand in den SEO-Berater. Offene
            Punkte bleiben offen.
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
              {busy === "anbieter-evaluate"
                ? "Wertet aus…"
                : anbieter && anbieter.status !== "empty"
                  ? "Bestand neu auswerten"
                  : "Bestand auswerten"}
            </Button>
            {anbieter?.status === "proposed" ? (
              <Button
                type="button"
                className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
                disabled={busy != null}
                onClick={() => void postAnbieter("approve")}
              >
                {busy === "anbieter-approve" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden />
                )}
                {anbieter.approvedFingerprint
                  ? "Erneut freigeben"
                  : "Freigeben und in den SEO-Berater schreiben"}
              </Button>
            ) : null}
          </div>
          {busy === "anbieter-evaluate" ? (
            <p className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Die Auswertung läuft. Das kann einige Minuten dauern. Die Buttons sind solange gesperrt.
            </p>
          ) : null}
          {anbieterError ? <p className="text-sm text-destructive">{anbieterError}</p> : null}
          {anbieter?.status === "empty" && busy !== "anbieter-evaluate" ? (
            <p className="text-sm text-secondary">
              Der dunkle Freigabe-Button erscheint unter den Punkten, sobald der Vorschlag da ist.
            </p>
          ) : null}
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
            keine eigenen Avatare. Schmerz, Traumergebnis, Hürde, Zeit und Aufwand entstehen in der
            Akte, nachdem der Plan freigegeben ist.
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
              {busy === "plan" ? "Plan wird vorgeschlagen…" : avatarPlan && avatarPlan.avatars.length > 0 ? "Plan neu vorschlagen" : "Avatar-Plan vorschlagen"}
            </Button>
            {planEditable ? (
              <Button
                type="button"
                className="bg-sbkm-navy text-white hover:bg-sbkm-ink-700"
                disabled={busy != null}
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
            ) : null}
          </div>
          {busy === "plan" ? (
            <p className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Der Avatar-Plan wird vorgeschlagen. Das kann einige Minuten dauern.
            </p>
          ) : null}
          {avatarError ? <p className="text-sm text-destructive">{avatarError}</p> : null}
          {(avatarPlan?.status === "empty" || avatarPlan?.status === "stale") && busy !== "plan" ? (
            <p className="text-sm text-secondary">
              „Plan freigeben“ wird erst klickbar, wenn ein Vorschlag vorliegt.
            </p>
          ) : null}
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
                    <div className="grid gap-2 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Akte</p>
                      {avatar.dossier.narrative ? (
                        <p className="whitespace-pre-wrap">{avatar.dossier.narrative}</p>
                      ) : null}
                      <dl className="grid gap-1.5">
                        {AVATAR_VALUE_FIELDS.map((field) => {
                          const text = avatar.dossier?.[field.key]?.trim() ?? "";
                          return (
                            <div key={field.key}>
                              <dt className="font-medium text-primary">{field.label}</dt>
                              <dd className={text ? "whitespace-pre-wrap" : "text-secondary"}>
                                {text || "Noch nicht belegt."}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
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
