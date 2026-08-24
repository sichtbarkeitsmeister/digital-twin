"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, MessageCircle, Plus, Sparkles, Upload } from "lucide-react";

import {
  createFragebogenFromReviewAction,
  loadFragebogenCrawlStatusAction,
  loadFragebogenWizardContextAction,
  previewFragebogenFromOrgAction,
  requestFragebogenCrawlAction,
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
import { cn } from "@/lib/utils";
import type { SurveyPurpose } from "@/lib/surveys/purpose";
import {
  QUESTIONNAIRE_FILE_ACCEPT,
  readQuestionnaireFileText,
} from "@/lib/surveys/read-questionnaire-file-text";

type CoreItem = { key: string; title: string; description: string; stepTitle: string };

type ActiveCrawl = {
  id: string;
  status: string;
  pagesCrawled: number;
  pagesDiscovered: number;
  maxPages: number;
  message: string | null;
};

type FirstConversationSummary = {
  hasContent: boolean;
  filled: number;
  total: number;
  summaryLines: string[];
  wunschkundeLabel: string;
  updatedAt: string | null;
};

const CREATE_ORG_HREF = "/dashboard/admin/organisations#organisation-anlegen";
const ACTIVE_CRAWL = new Set(["queued", "running"]);

export function FragebogenFromOrgWizard(props: {
  organisationId: string | null;
  organisations: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const organisationId = props.organisationId;
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"configure" | "review">("configure");
  const [purpose, setPurpose] = useState<SurveyPurpose>("anbieter");
  const [wunschkundeLabel, setWunschkundeLabel] = useState("");
  const [includeAiExtras, setIncludeAiExtras] = useState(true);
  const [extraPlacement, setExtraPlacement] = useState<"start" | "end">("end");
  const [savePrefills, setSavePrefills] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [orgName, setOrgName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [lastCrawledAt, setLastCrawledAt] = useState<string | null>(null);
  const [lastCrawlError, setLastCrawlError] = useState<string | null>(null);
  const [activeCrawl, setActiveCrawl] = useState<ActiveCrawl | null>(null);
  const [seoSummary, setSeoSummary] = useState<string | null>(null);
  const [firstConv, setFirstConv] = useState<FirstConversationSummary | null>(null);
  const [skipCrawl, setSkipCrawl] = useState(false);
  const [crawlBusy, setCrawlBusy] = useState(false);
  const [anbieterCore, setAnbieterCore] = useState<CoreItem[]>([]);
  const [personaCore, setPersonaCore] = useState<CoreItem[]>([]);
  const [sourceDocuments, setSourceDocuments] = useState<
    Array<{ name: string; text: string }>
  >([]);
  const [uploadBusy, setUploadBusy] = useState(false);
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
      setLastCrawledAt(null);
      setLastCrawlError(null);
      setActiveCrawl(null);
      setSeoSummary(null);
      setFirstConv(null);
      setSkipCrawl(false);
      setSourceDocuments([]);
      setError(null);
      return;
    }
    setLoadingCtx(true);
    setSkipCrawl(false);
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
      setLastCrawledAt(res.data.lastCrawledAt);
      setLastCrawlError(res.data.lastCrawlError);
      setActiveCrawl(res.data.activeCrawl);
      setSeoSummary(res.data.seoSummary);
      setFirstConv(res.data.firstConversation);
      setAnbieterCore(res.data.anbieterCore);
      setPersonaCore(res.data.personaCore);
      setSelectedKeys(res.data.anbieterCore.map((c) => c.key));
      if (res.data.firstConversation.wunschkundeLabel) {
        setWunschkundeLabel(res.data.firstConversation.wunschkundeLabel);
      }
      setLoadingCtx(false);

      const needsCrawl =
        Boolean(res.data.websiteUrl) &&
        res.data.pageCount === 0 &&
        !res.data.activeCrawl;
      if (needsCrawl) {
        const started = await requestFragebogenCrawlAction({ organisationId });
        if (cancelled) return;
        if (started.ok && started.data) {
          setPageCount(started.data.pageCount);
          setActiveCrawl(started.data.activeCrawl);
          setStatus(started.message);
        } else if (!started.ok) {
          setLastCrawlError(started.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  useEffect(() => {
    if (!organisationId) return;
    if (!activeCrawl || !ACTIVE_CRAWL.has(activeCrawl.status)) return;
    let cancelled = false;
    const tick = async () => {
      const res = await loadFragebogenCrawlStatusAction({ organisationId });
      if (cancelled || !res.ok || !res.data) return;
      setPageCount(res.data.pageCount);
      setWebsiteUrl(res.data.websiteUrl);
      setLastCrawledAt(res.data.lastCrawledAt);
      setLastCrawlError(res.data.lastCrawlError);
      setActiveCrawl(res.data.activeCrawl);
      if (res.data.pageCount > 0 && !res.data.activeCrawl) {
        setStatus("Crawl fertig. Inhalte stehen für die Vorausfüllung bereit.");
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [organisationId, activeCrawl?.id, activeCrawl?.status]);

  useEffect(() => {
    const items = purpose === "anbieter" ? anbieterCore : personaCore;
    if (items.length === 0) return;
    setSelectedKeys(items.map((c) => c.key));
    setIncludeAiExtras(true);
  }, [purpose, anbieterCore, personaCore]);

  const selectedCount = useMemo(
    () => selectedKeys.filter((k) => coreItems.some((c) => c.key === k)).length,
    [selectedKeys, coreItems],
  );

  const coreGroups = useMemo(() => {
    const groups: Array<{ title: string; items: CoreItem[] }> = [];
    for (const item of coreItems) {
      const last = groups[groups.length - 1];
      if (last && last.title === item.stepTitle) last.items.push(item);
      else groups.push({ title: item.stepTitle, items: [item] });
    }
    return groups;
  }, [coreItems]);

  async function onUploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    setUploadBusy(true);
    const next: Array<{ name: string; text: string }> = [];
    const failures: string[] = [];
    try {
      for (const file of Array.from(fileList)) {
        try {
          const text = await readQuestionnaireFileText(file);
          next.push({ name: file.name, text });
        } catch (err) {
          failures.push(err instanceof Error ? err.message : `„${file.name}“ nicht lesbar.`);
        }
      }
      setSourceDocuments((prev) => {
        const merged = [...prev];
        for (const doc of next) {
          const i = merged.findIndex((d) => d.name === doc.name);
          if (i >= 0) merged[i] = doc;
          else merged.push(doc);
        }
        return merged.slice(0, 8);
      });
      if (failures.length) setError(failures.join(" "));
    } finally {
      setUploadBusy(false);
    }
  }

  function requestCrawl() {
    if (!organisationId) return;
    setError(null);
    setCrawlBusy(true);
    void (async () => {
      const res = await requestFragebogenCrawlAction({ organisationId });
      setCrawlBusy(false);
      if (!res.ok || !res.data) {
        setLastCrawlError(res.message);
        setError(res.message);
        return;
      }
      setPageCount(res.data.pageCount);
      setActiveCrawl(res.data.activeCrawl);
      setSkipCrawl(false);
      setStatus(res.message);
    })();
  }

  function runPreview() {
    if (!organisationId) {
      setError("Bitte zuerst eine Organisation wählen oder anlegen.");
      return;
    }
    const crawlRunning = Boolean(activeCrawl && ACTIVE_CRAWL.has(activeCrawl.status));
    if (websiteUrl && pageCount === 0 && !skipCrawl) {
      setError(
        crawlRunning
          ? "Crawl läuft noch. Bitte warten oder unten „Ohne Crawl fortfahren“ wählen."
          : "Bitte zuerst den Website-Crawl anstoßen — oder unten ohne Crawl fortfahren.",
      );
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
        meetingBriefing: null,
        sourceDocuments,
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
            Vorausgefüllte Antworten aus Dateien und Crawl bitte prüfen — passen sie, oder
            muss etwas angepasst werden? Erst danach wird der Fragebogen angelegt.
          </p>
        </div>

        {draft.aiWarning ? (
          <p
            className="rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            {draft.aiWarning}
          </p>
        ) : null}

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
          {included
            .filter((q) => q.kind === "core")
            .map((q) => (
            <FragebogenReviewQuestionEditor
              key={q.id}
              question={q}
              index={included.findIndex((row) => row.id === q.id)}
              total={included.length}
              onChange={(patch) => updateQuestion(q.id, patch)}
              onReplace={(next) => replaceQuestion(q.id, next)}
              onRemove={() => removeQuestion(q.id)}
              onMove={(delta) => moveQuestion(q.id, delta)}
            />
          ))}
          <div className="grid gap-2 pt-2">
            <h2 className="text-base font-semibold text-primary">
              KI-Vorschläge und Zusatzfragen
            </h2>
            <p className="text-sm text-secondary">
              Eigener letzter Block im Fragebogen — nicht Teil der Standardvorlage.
            </p>
          </div>
          {included.filter((q) => q.kind === "extra").length === 0 ? (
            <p className="rounded-xl border border-dashed border-sbkm-navy/20 px-3 py-2 text-sm text-secondary">
              In diesem Entwurf sind keine KI-Zusatzfragen. Unten kannst du welche ergänzen
              oder die Prüfung erneut erzeugen.
            </p>
          ) : (
            included
              .filter((q) => q.kind === "extra")
              .map((q) => (
                <FragebogenReviewQuestionEditor
                  key={q.id}
                  question={q}
                  index={included.findIndex((row) => row.id === q.id)}
                  total={included.length}
                  onChange={(patch) => updateQuestion(q.id, patch)}
                  onReplace={(next) => replaceQuestion(q.id, next)}
                  onRemove={() => removeQuestion(q.id)}
                  onMove={(delta) => moveQuestion(q.id, delta)}
                />
              ))
          )}
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
          Vor dem Erzeugen: Website crawlen, Gesprächsnotizen hochladen, dann prüfen. Alles, was
          Dateien, Crawl und SEO-Zahlen hergeben (Team, Leistungen, Presse), wird vorausgefüllt.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Organisation & Crawl</CardTitle>
          <CardDescription>
            Der Website-Crawl wird vor dem Erzeugen angestoßen. Daraus kommen Team, Leistungen,
            Über-uns- und Presseseiten — und soweit vorhanden Impressionen und Rankings.
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
              Noch keine Organisation gewählt. Bitte oben auswählen oder neu anlegen.
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
                {seoSummary ? <Badge variant="outline">{seoSummary}</Badge> : null}
                {activeCrawl && ACTIVE_CRAWL.has(activeCrawl.status) ? (
                  <Badge variant="secondary">
                    Crawl {activeCrawl.status}: {activeCrawl.pagesCrawled}
                    {activeCrawl.pagesDiscovered
                      ? ` / ${activeCrawl.pagesDiscovered}`
                      : ""}{" "}
                    Seiten
                  </Badge>
                ) : null}
              </div>
              {!websiteUrl ? (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Ohne Website-URL kann kein Crawl starten. Bitte unter SEO die Website setzen.
                </p>
              ) : activeCrawl && ACTIVE_CRAWL.has(activeCrawl.status) ? (
                <p className="text-xs text-secondary">
                  Crawl läuft im Hintergrund
                  {activeCrawl.message ? ` — ${activeCrawl.message}` : "."} Sobald Seiten da
                  sind, werden sie vorausgefüllt.
                </p>
              ) : pageCount === 0 ? (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {lastCrawlError
                    ? lastCrawlError
                    : "Noch kein Crawl. Bitte starten — sonst bleibt die Vorausfüllung dünn."}
                </p>
              ) : (
                <p className="text-xs text-secondary">
                  Crawl-Inhalte und SEO-Zahlen werden für Antwort-Vorschläge genutzt. Alles bleibt
                  in der Prüfung editierbar.
                  {lastCrawledAt
                    ? ` Zuletzt gecrawlt ${new Date(lastCrawledAt).toLocaleString("de-DE")}.`
                    : ""}
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!organisationId || crawlBusy || loadingCtx || !websiteUrl}
              onClick={requestCrawl}
            >
              {crawlBusy || (activeCrawl && ACTIVE_CRAWL.has(activeCrawl.status)) ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Crawl läuft…
                </>
              ) : pageCount > 0 ? (
                "Crawl aktualisieren"
              ) : (
                "Crawl starten"
              )}
            </Button>
            {organisationId ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(organisationId)}`}
                >
                  SEO / Website
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

          {websiteUrl && pageCount === 0 ? (
            <label className="flex items-center gap-2 text-xs text-secondary">
              <input
                type="checkbox"
                checked={skipCrawl}
                onChange={(e) => setSkipCrawl(e.target.checked)}
              />
              Ohne Crawl fortfahren (Vorausfüllung dann nur aus Erstgespräch)
            </label>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="size-4" aria-hidden />
            2. Erstgespräch / Kundendefinition
          </CardTitle>
          <CardDescription>
            Das erste Gespräch liegt auf einer eigenen Seite. Gespeicherte Angaben werden hier
            übernommen — der Kunde soll sie nicht nochmal tippen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {!organisationId ? (
            <p className="text-xs text-secondary">Zuerst Organisation wählen.</p>
          ) : !firstConv?.hasContent ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Noch kein Erstgespräch für diese Organisation. Bitte zuerst die Kundendefinition
              führen — oder den Fragebogen nur aus Crawl erzeugen.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">
                  {firstConv.filled}/{firstConv.total} Felder
                </Badge>
              </div>
              <ul className="grid gap-1 text-xs text-secondary">
                {firstConv.summaryLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          {organisationId ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link
                  href={`/dashboard/erstgespraech?org=${encodeURIComponent(organisationId)}`}
                >
                  Erstgespräch öffnen
                </Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4" aria-hidden />
            2b. Gesprächsnotizen und Unterlagen
          </CardTitle>
          <CardDescription>
            Meeting-Protokolle, vorhandene Gespräche oder Zusammenfassungen hochladen. Die KI
            prüft, welche Fragen darin schon beantwortet sind, und füllt die Antworten vor —
            danach nur noch gegenlesen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid max-w-md gap-2">
            <Label htmlFor="source-docs">Dateien (.docx, .txt, .md)</Label>
            <Input
              id="source-docs"
              type="file"
              multiple
              accept={QUESTIONNAIRE_FILE_ACCEPT}
              disabled={!organisationId || uploadBusy}
              onChange={(e) => {
                void onUploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {uploadBusy ? (
            <p className="text-xs text-secondary">Dateien werden gelesen…</p>
          ) : null}
          {sourceDocuments.length > 0 ? (
            <ul className="grid gap-1">
              {sourceDocuments.map((doc) => (
                <li
                  key={doc.name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-sbkm-navy/10 px-3 py-2 text-xs"
                >
                  <span>
                    {doc.name} · {doc.text.length.toLocaleString("de-DE")} Zeichen
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSourceDocuments((prev) => prev.filter((d) => d.name !== doc.name))
                    }
                  >
                    Entfernen
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-secondary">
              Optional. Ohne Dateien kommt die Vorausfüllung aus Crawl und Erstgespräch.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">3. Zweck</CardTitle>
          <CardDescription>
            Anbieter-Fragebogen und Wunschkunden-Fragebogen gehen an den Kunden.
          </CardDescription>
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
            4. Standardfragen ({coreItems.length}, alle Pflichtfelder)
          </CardTitle>
          <CardDescription>
            Alle Kernfragen sind vorausgewählt und Pflichtfelder. In der Prüfung können Antworten
            aus Dateien und Crawl angepasst werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {coreGroups.map((group) => (
            <div key={group.title} className="grid gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-secondary">
                {group.title}
              </p>
              {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex gap-3 rounded-xl border border-sbkm-mint/40 bg-sbkm-mint/10 px-3 py-2.5 text-sm"
                  >
                    <span className="grid gap-0.5">
                      <span className="font-medium text-primary">{item.title}</span>
                      {item.description ? (
                        <span className="text-xs text-secondary">{item.description}</span>
                      ) : null}
                    </span>
                  </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" aria-hidden />
            5. Individuelle Fragen (letzter Block)
          </CardTitle>
          <CardDescription>
            Die KI schlägt danach Sonderfragen für das jeweilige Unternehmen vor. In der Prüfung
            kannst du sie bearbeiten, kopieren oder löschen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeAiExtras}
              onChange={(e) => setIncludeAiExtras(e.target.checked)}
            />
            KI-Fragen für dieses Unternehmen vorschlagen
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
          disabled={
            isPending ||
            loadingCtx ||
            !organisationId ||
            selectedCount === 0 ||
            Boolean(websiteUrl && pageCount === 0 && !skipCrawl)
          }
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
