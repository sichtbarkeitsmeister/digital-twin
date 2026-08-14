"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";

import {
  createFragebogenFromOrgAction,
  loadFragebogenWizardContextAction,
} from "@/app/dashboard/frageboegen/actions";
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

type CoreItem = { key: string; title: string; description: string };

export function FragebogenFromOrgWizard(props: {
  organisationId: string;
  organisations: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [purpose, setPurpose] = useState<"anbieter" | "persona">("anbieter");
  const [wunschkundeLabel, setWunschkundeLabel] = useState("");
  const [includeAiExtras, setIncludeAiExtras] = useState(true);
  const [extraPlacement, setExtraPlacement] = useState<"start" | "end">("end");
  const [savePrefills, setSavePrefills] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [orgName, setOrgName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [anbieterCore, setAnbieterCore] = useState<CoreItem[]>([]);
  const [personaCore, setPersonaCore] = useState<CoreItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(true);

  const coreItems = purpose === "anbieter" ? anbieterCore : personaCore;

  useEffect(() => {
    let cancelled = false;
    setLoadingCtx(true);
    setError(null);
    void (async () => {
      const res = await loadFragebogenWizardContextAction({
        organisationId: props.organisationId,
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
  }, [props.organisationId]);

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

  function create() {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      setStatus(
        includeAiExtras
          ? "Fragebogen wird erzeugt (Kernfragen + KI-Zusatz aus Crawl)…"
          : "Fragebogen wird aus Kernfragen erzeugt…",
      );
      const res = await createFragebogenFromOrgAction({
        organisationId: props.organisationId,
        purpose,
        wunschkundeLabel: purpose === "persona" ? wunschkundeLabel : null,
        selectedCoreKeys: selectedKeys.filter((k) =>
          coreItems.some((c) => c.key === k),
        ),
        includeAiExtras,
        extraPlacement,
        savePrefills,
      });
      if (!res.ok || !res.data) {
        setStatus(null);
        setError(res.message);
        return;
      }
      const target = res.data.responseId
        ? `/dashboard/surveys/${res.data.surveyId}/responses/${res.data.responseId}`
        : `/dashboard/surveys/${res.data.surveyId}/edit`;
      router.push(target);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Fragebogen aus Organisation
        </h1>
        <p className="max-w-2xl text-sm text-secondary">
          Organisation und Website/Crawl zuerst — dann Fragebogen mit festen Kernfragen und
          optionalen KI-Zusatzfragen in wenigen Klicks.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Organisation & Crawl</CardTitle>
          <CardDescription>
            {loadingCtx
              ? "Lade Kontext…"
              : `${orgName || "Organisation"} · ${pageCount} Crawl-Seiten`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
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
          <p className="text-xs text-secondary">
            Website unter SEO-Einstellungen setzen und crawlen. Bekannte Fakten (Name, URL,
            ggf. Mitarbeiterzahl) können vorausgefüllt werden und bleiben editierbar.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(props.organisationId)}`}
              >
                SEO / Website / Crawl
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link
                href={`/dashboard/frageboegen?org=${encodeURIComponent(props.organisationId)}`}
              >
                Zurück zur Liste
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Zweck</CardTitle>
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
            <div className="grid gap-2 max-w-md">
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
            3. Kernfragen ({selectedCount}/{coreItems.length})
          </CardTitle>
          <CardDescription>
            Feste Basis für jeden Fragebogen dieses Typs — abwählen, was hier nicht passt.
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
            4. Individuelle Zusatzfragen
          </CardTitle>
          <CardDescription>
            Die KI entscheidet anhand Crawl/Kontext, welche Sonderfragen für diese Firma bzw.
            diesen Wunschkunden ergänzt werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeAiExtras}
              onChange={(e) => setIncludeAiExtras(e.target.checked)}
            />
            KI-Zusatzfragen erzeugen
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
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={savePrefills}
              onChange={(e) => setSavePrefills(e.target.checked)}
            />
            Bekannte Antworten vorausfüllen (Name/Website/Crawl) — später editierbar
          </label>
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
          disabled={isPending || loadingCtx || selectedCount === 0}
          onClick={create}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Erzeuge…
            </>
          ) : (
            "Fragebogen erzeugen"
          )}
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href={`/dashboard/frageboegen?org=${encodeURIComponent(props.organisationId)}`}>
            Abbrechen
          </Link>
        </Button>
      </div>
    </div>
  );
}
