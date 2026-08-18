"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";

import {
  createFragebogenFromReviewAction,
  loadFragebogenWizardContextAction,
  previewFragebogenFromOrgAction,
} from "@/app/dashboard/frageboegen/actions";
import { FragebogenReviewQuestionEditor } from "@/app/dashboard/frageboegen/_components/fragebogen-review-question-editor";
import type { FragebogenReviewDraft } from "@/lib/surveys/build-fragebogen-from-org";
import {
  createEmptyExtraQuestion,
  type ReviewQuestionItem,
} from "@/lib/surveys/fragebogen-review-draft";
import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type CoreItem = { key: string; title: string; description: string };

const CREATE_ORG_HREF = "/dashboard/admin/organisations#organisation-anlegen";

export function FragebogenFromOrgWizard(props: {
  organisationId: string | null;
  organisations: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const organisationId = props.organisationId;
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"configure" | "review">("configure");
  const [purpose, setPurpose] = useState<"anbieter" | "persona">("anbieter");
  const [wunschkundeLabel, setWunschkundeLabel] = useState("");
  const [includeAiExtras, setIncludeAiExtras] = useState(true);
  const [extraPlacement, setExtraPlacement] = useState<"start" | "end">("end");
  const [savePrefills, setSavePrefills] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [legalCompanyName, setLegalCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [goodCompetitors, setGoodCompetitors] = useState("");
  const [pagesOrLinks, setPagesOrLinks] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [orgName, setOrgName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [anbieterCore, setAnbieterCore] = useState<CoreItem[]>([]);
  const [personaCore, setPersonaCore] = useState<CoreItem[]>([]);
  const [draft, setDraft] = useState<FragebogenReviewDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(Boolean(organisationId));

  const coreItems = purpose === "anbieter" ? anbieterCore : personaCore;

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setStep("configure");
    if (!organisationId) {
      setLoadingCtx(false);
      setOrgName("");
      setWebsiteUrl(null);
      setPageCount(0);
      setError(null);
      return;
    }
    setLoadingCtx(true);
    setError(null);
    void (async () => {
      const res = await loadFragebogenWizardContextAction({
        organisationId,
      });
      if (cancelled) return;
      if (!res.ok || !res.data) {
        setError(res.message);
        setLoadingCtx(false);
        return;
      }
      setOrgName(res.data.organisationName);
      setWebsiteUrl(res.data.websiteUrl);
      setPageCount(res.data.pageCount);
      setAnbieterCore(res.data.anbieterCore);
      setPersonaCore(res.data.personaCore);
      setSelectedKeys(res.data.anbieterCore.map((c) => c.key));
      setLoadingCtx(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  useEffect(() => {
    const items = purpose === "anbieter" ? anbieterCore : personaCore;
    if (items.length === 0) return;
    setSelectedKeys(items.map((c) => c.key));
  }, [purpose, anbieterCore, personaCore]);

  const selectedCount = useMemo(
    () => selectedKeys.filter((k) => coreItems.some((c) => c.key === k)).length,
    [selectedKeys, coreItems],
  );

  function toggleKey(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function runPreview() {
    if (!organisationId) {
      setError("Bitte zuerst eine Organisation wählen oder anlegen.");
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      setStatus(
        includeAiExtras
          ? "Vorschau wird erzeugt (Kernfragen + Crawl/KI)…"
          : "Vorschau wird erzeugt…",
      );
      const res = await previewFragebogenFromOrgAction({
        organisationId,
        purpose,
        wunschkundeLabel: purpose === "persona" ? wunschkundeLabel : null,
        selectedCoreKeys: selectedKeys.filter((k) =>
          coreItems.some((c) => c.key === k),
        ),
        includeAiExtras,
        extraPlacement,
        meetingBriefing: {
          legalCompanyName: legalCompanyName || null,
          ownerName: ownerName || null,
          competitors: competitors || null,
          goodCompetitors: goodCompetitors || null,
          pagesOrLinks: pagesOrLinks || null,
          notes: meetingNotes || null,
        },
      });
      setStatus(null);
      if (!res.ok || !res.data) {
        setError(res.message);
        return;
      }
      setDraft(res.data.draft);
      setStep("review");
    });
  }

  function updateQuestion(
    id: string,
    patch: Partial<ReviewQuestionItem>,
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)),
      };
    });
  }

  function replaceQuestion(id: string, next: ReviewQuestionItem) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.id === id ? next : q)),
      };
    });
  }

  function removeQuestion(id: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = prev.questions.find((q) => q.id === id);
      if (!target) return prev;
      if (target.kind === "extra") {
        return {
          ...prev,
          questions: prev.questions.filter((q) => q.id !== id),
        };
      }
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === id ? { ...q, included: false } : q,
        ),
      };
    });
  }

  function moveQuestion(id: string, delta: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const visible = prev.questions.filter((q) => q.included);
      const from = visible.findIndex((q) => q.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= visible.length) return prev;
      const a = visible[from]!;
      const b = visible[to]!;
      const next = prev.questions.slice();
      const ia = next.findIndex((q) => q.id === a.id);
      const ib = next.findIndex((q) => q.id === b.id);
      [next[ia], next[ib]] = [next[ib]!, next[ia]!];
      return { ...prev, questions: next };
    });
  }

  function addExtraQuestion() {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: [...prev.questions, createEmptyExtraQuestion()],
      };
    });
  }

  function save() {
    if (!draft || !organisationId) return;
    setError(null);
    setStatus(null);
    startTransition(async () => {
      setStatus("Fragebogen wird gespeichert…");
      const res = await createFragebogenFromReviewAction({
        organisationId,
        savePrefills,
        draft,
      });
      if (!res.ok || !res.data) {
        setStatus(null);
        setError(res.message);
        return;
      }
      const target = `/dashboard/surveys/${res.data.surveyId}/edit`;
      router.push(target);
      router.refresh();
    });
  }

  if (step === "review" && draft) {
    const included = draft.questions.filter((q) => q.included);
    const prefilled = included.filter((q) => q.answer.trim()).length;
    return (
      <div className="grid gap-6">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Prüfung vor dem Speichern
          </h1>
          <p className="max-w-2xl text-sm text-secondary">
            Fragen umformulieren, Typ und Pflichtfeld setzen, Zusatzfragen ergänzen.
            Erst danach wird der Fragebogen angelegt — danach bleibt alles im Entwurf
            weiter editierbar.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{draft.title}</CardTitle>
            <CardDescription>
              {draft.organisationName} · {draft.crawlPageCount} Crawl-Seiten ·{" "}
              {included.length} Fragen · {prefilled} vorausgefüllt
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label htmlFor="draft-title">Titel</Label>
            <Input
              id="draft-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {included.map((q, visibleIndex) => (
            <FragebogenReviewQuestionEditor
              key={q.id}
              question={q}
              index={visibleIndex}
              total={included.length}
              onChange={(patch) => updateQuestion(q.id, patch)}
              onReplace={(next) => replaceQuestion(q.id, next)}
              onRemove={() => removeQuestion(q.id)}
              onMove={(delta) => moveQuestion(q.id, delta)}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="justify-center border-dashed"
            onClick={addExtraQuestion}
          >
            <Plus className="size-4" aria-hidden />
            Zusatzfrage ergänzen
          </Button>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={savePrefills}
            onChange={(e) => setSavePrefills(e.target.checked)}
          />
          Vorausgefüllte Antworten als Entwurf speichern
        </label>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        {status ? <p className="text-sm text-secondary">{status}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={isPending || included.length === 0} onClick={save}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Speichere…
              </>
            ) : (
              "Fragebogen speichern"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              setStep("configure");
              setDraft(null);
            }}
          >
            Zurück
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Fragebogen aus Organisation
        </h1>
        <p className="max-w-2xl text-sm text-secondary">
          Nach dem Kundengespräch: Mitbewerber, Inhaber und Notizen hier eintragen — Crawl füllt
          den Rest. Dann Vorschau prüfen und speichern.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Organisation & Crawl</CardTitle>
          <CardDescription>
            Organisation wählen — oft erst nach dem Kundengespräch angelegt. Crawl optional, aber
            hilfreich.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid gap-2 max-w-md">
            <Label>Organisation</Label>
            <OrganisationSwitcher
              organisations={props.organisations}
              selectedOrganisationId={organisationId}
              orgPath="/dashboard/frageboegen/neu"
            />
          </div>

          <p className="text-xs text-secondary">
            Ist die gewünschte Organisation nicht da? Dann bitte anlegen:{" "}
            <Link
              href={CREATE_ORG_HREF}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Organisation anlegen
            </Link>
          </p>

          {!organisationId ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Noch keine Organisation gewählt. Bitte oben auswählen oder neu anlegen — danach
              Briefing und Crawl.
            </p>
          ) : loadingCtx ? (
            <p className="text-xs text-secondary">Lade Crawl-Kontext…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{orgName || "…"}</Badge>
                {websiteUrl ? (
                  <Badge variant="secondary">{websiteUrl}</Badge>
                ) : (
                  <Badge variant="destructive">Keine Website hinterlegt</Badge>
                )}
                <Badge variant={pageCount > 0 ? "default" : "secondary"}>
                  {pageCount} Seiten gecrawlt
                </Badge>
              </div>
              {pageCount === 0 ? (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Noch kein Crawl — Prefill/KI-Zusatzfragen werden dünn. Bitte zuerst Website setzen
                  und crawlen (kann auch nach dem Anlegen der Organisation passieren).
                </p>
              ) : (
                <p className="text-xs text-secondary">
                  Crawl-Inhalte werden für Antwort-Vorschläge und Zusatzfragen genutzt. Alles bleibt
                  in der Prüfung editierbar.
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {organisationId ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(organisationId)}`}
                >
                  SEO / Website / Crawl
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost">
              <Link
                href={
                  organisationId
                    ? `/dashboard/frageboegen?org=${encodeURIComponent(organisationId)}`
                    : "/dashboard/frageboegen"
                }
              >
                Zurück zur Liste
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Kundengespräch / Briefing</CardTitle>
          <CardDescription>
            Inhalte aus dem Meeting direkt übernehmen — der Kunde soll das später nicht nochmal
            tippen. Leere Felder bleiben für Crawl/KI.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="legal-company">Offizieller Firmenname</Label>
              <Input
                id="legal-company"
                value={legalCompanyName}
                onChange={(e) => setLegalCompanyName(e.target.value)}
                placeholder={orgName ? `z. B. ${orgName}` : "z. B. Musterdruck GmbH"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="owner-name">Inhaber / Geschäftsführung</Label>
              <Input
                id="owner-name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="z. B. Max Mustermann"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="competitors">Mitbewerber</Label>
            <Textarea
              id="competitors"
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              rows={2}
              placeholder="Namen, Domains, kurze Notizen…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="good-competitors">Gute Wettbewerber / Vorbilder</Label>
            <Textarea
              id="good-competitors"
              value={goodCompetitors}
              onChange={(e) => setGoodCompetitors(e.target.value)}
              rows={2}
              placeholder="Starke Anbieter, an denen man sich orientiert…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pages-links">Genannte Seiten / Links</Label>
            <Textarea
              id="pages-links"
              value={pagesOrLinks}
              onChange={(e) => setPagesOrLinks(e.target.value)}
              rows={2}
              placeholder="Landingpages, URLs, Seitennamen aus dem Gespräch…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="meeting-notes">Weitere Gesprächsnotizen</Label>
            <Textarea
              id="meeting-notes"
              value={meetingNotes}
              onChange={(e) => setMeetingNotes(e.target.value)}
              rows={3}
              placeholder="Fokus, USP, Region, Zielgruppe, Besonderheiten…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">3. Zweck</CardTitle>
          <CardDescription>Anbieter-Firmenwissen oder Wunschkunden-Persona.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPurpose("anbieter")}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm font-medium transition",
                purpose === "anbieter"
                  ? "border-sbkm-mint/50 bg-sbkm-mint/15 text-primary"
                  : "border-sbkm-navy/10 hover:bg-sbkm-navy/5",
              )}
            >
              Anbieter-Fragebogen
            </button>
            <button
              type="button"
              onClick={() => setPurpose("persona")}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm font-medium transition",
                purpose === "persona"
                  ? "border-sbkm-mint/50 bg-sbkm-mint/15 text-primary"
                  : "border-sbkm-navy/10 hover:bg-sbkm-navy/5",
              )}
            >
              Kunden-Persona
            </button>
          </div>
          {purpose === "persona" ? (
            <div className="grid max-w-md gap-2">
              <Label htmlFor="wunschkunde">Wunschkunde / Avatar-Name</Label>
              <Input
                id="wunschkunde"
                value={wunschkundeLabel}
                onChange={(e) => setWunschkundeLabel(e.target.value)}
                placeholder="z. B. Julia Schröder"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            4. Kernfragen ({selectedCount}/{coreItems.length})
          </CardTitle>
          <CardDescription>
            Feste Basis — abwählen, was hier nicht gebraucht wird.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {coreItems.map((item) => {
            const checked = selectedKeys.includes(item.key);
            return (
              <label
                key={item.key}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
                  checked
                    ? "border-sbkm-mint/40 bg-sbkm-mint/10"
                    : "border-sbkm-navy/10 opacity-70",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => toggleKey(item.key)}
                />
                <span className="grid gap-0.5">
                  <span className="font-medium text-primary">{item.title}</span>
                  <span className="text-xs text-secondary">{item.description}</span>
                </span>
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" aria-hidden />
            5. Individuelle Zusatzfragen
          </CardTitle>
          <CardDescription>
            KI schlägt Sonderfragen aus Meeting/Crawl vor. Im nächsten Schritt kannst du
            weitere Zusatzfragen mit Typ, Pflichtfeld und Optionen ergänzen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeAiExtras}
              onChange={(e) => setIncludeAiExtras(e.target.checked)}
            />
            KI-Zusatzfragen vorschlagen
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!includeAiExtras}
              onClick={() => setExtraPlacement("end")}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                extraPlacement === "end"
                  ? "border-sbkm-mint/50 bg-sbkm-mint/15"
                  : "border-sbkm-navy/10",
              )}
            >
              Zusatzfragen am Ende
            </button>
            <button
              type="button"
              disabled={!includeAiExtras}
              onClick={() => setExtraPlacement("start")}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                extraPlacement === "start"
                  ? "border-sbkm-mint/50 bg-sbkm-mint/15"
                  : "border-sbkm-navy/10",
              )}
            >
              Zusatzfragen am Anfang
            </button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p className="text-sm text-secondary">{status}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={isPending || loadingCtx || !organisationId || selectedCount === 0}
          onClick={runPreview}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Erzeuge Vorschau…
            </>
          ) : (
            "Zur Prüfung"
          )}
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link
            href={
              organisationId
                ? `/dashboard/frageboegen?org=${encodeURIComponent(organisationId)}`
                : "/dashboard/frageboegen"
            }
          >
            Abbrechen
          </Link>
        </Button>
      </div>
    </div>
  );
}
