"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import { GROUNDING_REVIEW_CHECKLIST, GROUNDING_REVIEWER } from "@/lib/dt/prompts/grounding-page-standard";
import type { DiffItem, DiffItemKind } from "@/lib/dt/seo/grounding-check/diff";
import { factLabel, monthLabel, type OpenPointReason } from "@/lib/dt/seo/grounding-check/fact-model";
import type { GroundingRunDetail } from "@/lib/dt/seo/grounding-check/store";

/**
 * One Grounding check: what changed (Neu / Geändert / Entfällt / Unverändert), open points,
 * hints for the reviewer, the draft (preview, editable files, fact switches), the six-point
 * human review, downloads and „Als hochgeladen markieren“.
 */

const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50";
const LINK_CLASS = "inline-flex items-center gap-1 text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint";
const INPUT_CLASS =
  "h-10 min-w-0 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white";
const CODE_CLASS =
  "min-h-[320px] w-full rounded-xl border border-sbkm-navy/15 bg-white/80 p-3 font-mono text-xs leading-relaxed text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-70 dark:border-white/15 dark:bg-black/30 dark:text-white";

type RunResponse = { ok?: boolean; message?: string; run?: GroundingRunDetail; validation?: GroundingRunDetail["validation"] };

function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

const GROUPS: Array<{ kind: DiffItemKind; title: string; className: string }> = [
  { kind: "added", title: "Neu", className: "border-sbkm-mint/60 bg-sbkm-mint/10" },
  { kind: "changed", title: "Geändert", className: "border-amber-500/40 bg-amber-500/10" },
  { kind: "removed", title: "Entfällt", className: "border-red-400/40 bg-red-500/10" },
  { kind: "unchanged", title: "Unverändert", className: "border-sbkm-navy/10 bg-white/50 dark:border-white/10 dark:bg-white/[0.03]" },
];

const REASON_LABELS: Record<OpenPointReason, string> = {
  missing_on_website: "Fehlt auf der Website",
  internal_only: "Nur intern",
  conflict: "Widerspruch",
  unverified: "Nicht belegt",
  not_publishable: "Nicht für die Seite",
};

function DiffEntry({ item }: { item: DiffItem }) {
  return (
    <li className="grid gap-0.5 rounded-lg bg-white/60 px-3 py-2 text-xs text-sbkm-navy dark:bg-white/[0.04] dark:text-white">
      <p className="font-semibold">
        {item.entityName}
        <span className="font-normal text-sbkm-ink-600 dark:text-white/55"> · {item.label}</span>
        {item.via === "semantic" ? <span className="ml-1 text-[10px] uppercase text-sbkm-ink-600 dark:text-white/45">KI-Abgleich</span> : null}
      </p>
      {item.kind === "changed" ? (
        <p>
          <span className="text-sbkm-ink-600 line-through decoration-red-400/70 dark:text-white/50">{item.oldValue}</span>
          {" → "}
          <span>{item.newValue}</span>
        </p>
      ) : (
        <p className={cn(item.kind === "removed" && "text-sbkm-ink-600 line-through decoration-red-400/70 dark:text-white/50")}>
          {item.kind === "removed" ? item.oldValue : item.newValue}
        </p>
      )}
      {item.note ? <p className="text-sbkm-ink-600 dark:text-white/55">{item.note}</p> : null}
      {item.sourceUrl ? (
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className={LINK_CLASS} title={item.quote ?? undefined}>
          Quelle: {shortUrl(item.sourceUrl)}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </li>
  );
}

function DiffView({ run }: { run: GroundingRunDetail }) {
  const diff = run.diff;
  if (!diff) return null;
  return (
    <div className="grid gap-3">
      {diff.structural.length > 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-bold text-amber-900 dark:text-amber-100">Befunde zum Standard v1.7 ({diff.structural.length})</p>
          <ul className="mt-1.5 grid gap-1 text-xs text-amber-900 dark:text-amber-100">
            {diff.structural.map((issue) => (
              <li key={issue.code} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {GROUPS.map((group) => {
        const items = diff.items.filter((i) => i.kind === group.kind);
        if (items.length === 0) return null;
        const list = (
          <ul className="mt-2 grid gap-1.5">
            {items.map((item) => (
              <DiffEntry key={item.id} item={item} />
            ))}
          </ul>
        );
        return (
          <details key={group.kind} open={group.kind !== "unchanged"} className={cn("rounded-xl border p-3", group.className)}>
            <summary className="cursor-pointer text-xs font-bold text-sbkm-navy dark:text-white">
              {group.title} ({items.length})
            </summary>
            {list}
          </details>
        );
      })}
    </div>
  );
}

function OpenPoints({ run }: { run: GroundingRunDetail }) {
  if (run.openPoints.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className={LABEL_CLASS}>Offene Punkte ({run.openPoints.length}) · stehen nicht auf der Seite</p>
      <ul className="grid gap-1.5">
        {run.openPoints.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start gap-2 rounded-lg bg-white/60 px-3 py-2 text-xs text-sbkm-navy dark:bg-white/[0.04] dark:text-white">
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {REASON_LABELS[p.reason]}
            </Badge>
            <span className="min-w-0 flex-1">
              {p.text}
              {p.source ? <span className="block text-sbkm-ink-600 dark:text-white/50">Quelle: {p.source}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hints({ run }: { run: GroundingRunDetail }) {
  const { hints } = run;
  const blocked = hints.robots.crawlers.filter((c) => c.status !== "allowed");
  return (
    <div className="grid gap-2">
      <p className={LABEL_CLASS}>Hinweise für die Prüfung (nicht auf der Seite)</p>
      <ul className="grid gap-1.5 text-xs text-sbkm-navy dark:text-white">
        <li className="flex gap-1.5">
          {hints.footerLink?.nextToLegal ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-sbkm-mint" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
          )}
          {hints.footerLink == null
            ? "Footer-Link: noch keine Grounding Page – nach dem Upload im Footer neben Impressum und Datenschutz verlinken (z. B. „Fakten“)."
            : hints.footerLink.nextToLegal
              ? `Footer-Link neben Impressum/Datenschutz vorhanden („${hints.footerLink.label ?? "Link"}“).`
              : hints.footerLink.inFooter
                ? "Die Seite ist im Footer verlinkt, aber nicht neben Impressum/Datenschutz."
                : "Die Grounding Page ist nicht im Footer verlinkt. Empfehlung: Link „Fakten“ neben Impressum und Datenschutz."}
        </li>
        <li className="flex gap-1.5">
          {blocked.length === 0 ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-sbkm-mint" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
          )}
          <span>
            {hints.robots.found ? "robots.txt: " : "Keine robots.txt gefunden – alle Crawler erlaubt. "}
            {hints.robots.found && blocked.length === 0 ? "KI-Crawler (GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended) sind erlaubt." : null}
            {blocked.map((c) => (
              <span key={c.bot} className="block">
                {c.detail}
              </span>
            ))}
          </span>
        </li>
        <li className="flex gap-1.5">
          {hints.llmsTxt.found ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-sbkm-mint" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
          )}
          {hints.llmsTxt.found ? `llms.txt gefunden: ${hints.llmsTxt.url}` : "Keine llms.txt auf der Website – der Entwurf liefert eine."}
        </li>
      </ul>
    </div>
  );
}

function CrawledPages({ run }: { run: GroundingRunDetail }) {
  if (run.crawledUrls.length === 0) return null;
  const { crawl } = run.hints;
  return (
    <details className="rounded-xl border border-sbkm-navy/10 p-3 dark:border-white/10">
      <summary className="cursor-pointer text-xs font-bold text-sbkm-navy dark:text-white">
        Gelesene Seiten ({crawl.pages}; {crawl.cached} aus dem letzten Crawl, {crawl.live} live
        {crawl.failed > 0 ? `, ${crawl.failed} nicht lesbar` : ""})
      </summary>
      <ul className="mt-2 grid gap-1 text-xs">
        {run.crawledUrls.map((entry) => (
          <li key={entry.url} className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {entry.category}
            </Badge>
            <a href={entry.url} target="_blank" rel="noreferrer" className={cn(LINK_CLASS, !entry.ok && "text-sbkm-ink-600 line-through dark:text-white/50")}>
              {shortUrl(entry.url)}
            </a>
            {entry.ok ? (
              <span className="text-sbkm-ink-600 dark:text-white/45">{entry.source === "cache" ? "Crawl" : "live"}</span>
            ) : (
              <span className="text-red-700 dark:text-red-300">{entry.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ValidationList({ validation }: { validation: GroundingRunDetail["validation"] }) {
  if (!validation) return null;
  const errors = validation.issues.filter((i) => i.severity === "error");
  const warnings = validation.issues.filter((i) => i.severity === "warning");
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-sbkm-navy dark:text-sbkm-mint">
        <CheckCircle2 className="size-3.5" aria-hidden />
        Technische Prüfung ohne Befund: JSON-LD gültig, HTML und JSON-LD spiegeln sich, jeder Fakt mit Quelle.
      </p>
    );
  }
  return (
    <div className="grid gap-1.5 text-xs">
      {errors.map((i, n) => (
        <p key={`e${n}`} className="flex gap-1.5 text-red-800 dark:text-red-200">
          <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {i.message}
        </p>
      ))}
      {warnings.map((i, n) => (
        <p key={`w${n}`} className="flex gap-1.5 text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {i.message}
        </p>
      ))}
    </div>
  );
}

function FactSwitches(props: { run: GroundingRunDetail; disabled: boolean; onApply: (body: Record<string, unknown>) => Promise<boolean> }) {
  const model = props.run.factModel;
  const [entityOn, setEntityOn] = useState<Record<string, boolean>>({});
  const [factOn, setFactOn] = useState<Record<string, boolean>>({});
  const [faqOn, setFaqOn] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setEntityOn({});
    setFactOn({});
    setFaqOn({});
  }, [props.run.id, props.run.factModel]);
  if (!model) return null;
  const dirty = Object.keys(entityOn).length + Object.keys(factOn).length + Object.keys(faqOn).length > 0;

  async function apply() {
    const facts = [
      ...Object.entries(entityOn).map(([entityId, included]) => ({ entityId, factId: null, included })),
      ...Object.entries(factOn).map(([key, included]) => {
        const [entityId, factId] = key.split("::");
        return { entityId, factId, included };
      }),
    ];
    const faq = Object.entries(faqOn).map(([faqId, included]) => ({ faqId, included }));
    if (await props.onApply({ action: "save", facts, faq })) {
      setEntityOn({});
      setFactOn({});
      setFaqOn({});
    }
  }

  return (
    <details className="rounded-xl border border-sbkm-navy/10 p-3 dark:border-white/10">
      <summary className="cursor-pointer text-xs font-bold text-sbkm-navy dark:text-white">Fakten auf der Seite ein- oder ausschalten</summary>
      <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">
        Übernehmen erzeugt grounding.html und llms.txt neu aus den Fakten. Handänderungen am HTML gehen dabei verloren.
      </p>
      <div className="mt-2 grid gap-2">
        {model.entities.map((entity) => {
          const entityChecked = entityOn[entity.id] ?? entity.included;
          return (
            <div key={entity.id} className="rounded-lg bg-white/60 p-2 text-xs dark:bg-white/[0.04]">
              <label className="flex items-center gap-2 font-semibold text-sbkm-navy dark:text-white">
                <input
                  type="checkbox"
                  className="size-4 accent-sbkm-navy"
                  checked={entityChecked}
                  disabled={props.disabled || entity.kind === "organization"}
                  onChange={(e) => setEntityOn((prev) => ({ ...prev, [entity.id]: e.target.checked }))}
                />
                {entity.name}
                <span className="font-normal text-sbkm-ink-600 dark:text-white/50">
                  {entity.schemaType} · {entity.ontologyClass.replace(" Entity Class", "")}
                </span>
              </label>
              <ul className="mt-1 grid gap-0.5 pl-6">
                {entity.facts.map((fact) => {
                  const key = `${entity.id}::${fact.id}`;
                  return (
                    <li key={fact.id}>
                      <label className="flex items-start gap-2 text-sbkm-navy dark:text-white/85">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5 accent-sbkm-navy"
                          checked={factOn[key] ?? fact.included}
                          disabled={props.disabled || !entityChecked}
                          onChange={(e) => setFactOn((prev) => ({ ...prev, [key]: e.target.checked }))}
                        />
                        <span>
                          <span className="font-semibold">{factLabel(fact.key, entity.kind)}:</span> {fact.value}
                          {fact.volatile && fact.asOf ? ` (Stand ${monthLabel(fact.asOf)})` : ""}{" "}
                          <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className={LINK_CLASS} title={fact.quote}>
                            Quelle
                          </a>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {model.faq.length > 0 ? (
          <div className="rounded-lg bg-white/60 p-2 text-xs dark:bg-white/[0.04]">
            <p className="font-semibold text-sbkm-navy dark:text-white">FAQ</p>
            <ul className="mt-1 grid gap-0.5">
              {model.faq.map((f) => (
                <li key={f.id}>
                  <label className="flex items-start gap-2 text-sbkm-navy dark:text-white/85">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-sbkm-navy"
                      checked={faqOn[f.id] ?? f.included}
                      disabled={props.disabled}
                      onChange={(e) => setFaqOn((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                    />
                    {f.question}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <DtPillButton type="button" size="sm" variant="outline" disabled={props.disabled || !dirty} onClick={() => void apply()}>
            Übernehmen und neu erzeugen
          </DtPillButton>
        </div>
      </div>
    </details>
  );
}

type DraftTab = "preview" | "html" | "llms";

function DraftEditor(props: { run: GroundingRunDetail; editable: boolean; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const { run } = props;
  const [tab, setTab] = useState<DraftTab>("preview");
  const [html, setHtml] = useState(run.draftHtml ?? "");
  const [llms, setLlms] = useState(run.draftLlmsTxt ?? "");
  useEffect(() => {
    setHtml(run.draftHtml ?? "");
    setLlms(run.draftLlmsTxt ?? "");
  }, [run.id, run.draftHtml, run.draftLlmsTxt]);
  const dirty = html !== (run.draftHtml ?? "") || llms !== (run.draftLlmsTxt ?? "");

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["preview", "Vorschau"],
            ["html", "grounding.html"],
            ["llms", "llms.txt"],
          ] as Array<[DraftTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-pill border px-3 py-1 text-xs font-semibold",
              tab === key
                ? "border-sbkm-navy bg-sbkm-navy text-white dark:border-sbkm-mint dark:bg-sbkm-mint dark:text-sbkm-navy"
                : "border-sbkm-navy/15 text-sbkm-navy dark:border-white/15 dark:text-white",
            )}
          >
            {label}
          </button>
        ))}
        {props.editable && dirty ? (
          <DtPillButton
            type="button"
            size="sm"
            disabled={props.busy}
            onClick={() => void props.onSave({ action: "save", draftHtml: html, draftLlmsTxt: llms })}
            className="ml-auto gap-1.5"
          >
            {props.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileCode2 className="size-4" aria-hidden />}
            Änderungen speichern
          </DtPillButton>
        ) : null}
      </div>
      {tab === "preview" ? (
        // No allow-* tokens: the draft runs without scripts, forms, popups or same-origin access.
        <iframe title="Vorschau grounding.html" sandbox="" srcDoc={html} referrerPolicy="no-referrer" className="h-[640px] w-full rounded-xl border border-sbkm-navy/15 bg-white dark:border-white/15" />
      ) : tab === "html" ? (
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} readOnly={!props.editable} spellCheck={false} className={CODE_CLASS} aria-label="grounding.html" />
      ) : (
        <textarea value={llms} onChange={(e) => setLlms(e.target.value)} readOnly={!props.editable} spellCheck={false} className={CODE_CLASS} aria-label="llms.txt" />
      )}
    </div>
  );
}

function ReviewForm(props: { run: GroundingRunDetail; viewerName: string; busy: string | null; onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(props.viewerName);
  const [note, setNote] = useState("");
  useEffect(() => setName((prev) => prev || props.viewerName), [props.viewerName]);
  const complete = GROUNDING_REVIEW_CHECKLIST.every((i) => checked[i.id]);
  const blocked = props.run.validation?.issues.some((i) => i.severity === "error") ?? false;

  return (
    <div className="grid gap-3 rounded-xl border border-sbkm-navy/15 bg-white/60 p-3 dark:border-white/15 dark:bg-white/[0.04]">
      <div>
        <p className="text-sm font-bold text-sbkm-navy dark:text-white">Menschliche Faktenprüfung (Standard v1.7)</p>
        <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
          Prüfen Sie den Entwurf an der Website. Auf der Seite steht danach „{`Fakten geprüft von ${GROUNDING_REVIEWER.name}`}“ mit dem heutigen
          Datum; Ihr Name wird nur hier gespeichert.
        </p>
      </div>
      <ul className="grid gap-2">
        {GROUNDING_REVIEW_CHECKLIST.map((item) => (
          <li key={item.id}>
            <label className="flex items-start gap-2 text-xs text-sbkm-navy dark:text-white">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-sbkm-navy"
                checked={Boolean(checked[item.id])}
                onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
              />
              <span>
                <span className="font-semibold">{item.label}:</span> {item.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>Geprüft von (intern)</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} placeholder="Vor- und Nachname" />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>Anmerkung (optional)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} placeholder="z. B. Öffnungszeiten telefonisch bestätigt" />
        </label>
      </div>
      {blocked ? (
        <p className="text-xs text-red-800 dark:text-red-200">Die technische Prüfung meldet Fehler. Bitte zuerst im HTML beheben oder Fakten umschalten.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <DtPillButton
          type="button"
          size="sm"
          disabled={props.busy != null || !complete || !name.trim() || blocked}
          onClick={() => void props.onSubmit({ action: "approve", reviewChecklist: checked, reviewerName: name, reviewNote: note || null })}
          className="gap-1.5"
        >
          {props.busy === "approve" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
          Freigeben
        </DtPillButton>
        <DtPillButton
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.busy != null}
          onClick={() => {
            if (window.confirm("Entwurf ablehnen? Er wird nicht veröffentlicht; eine neue Prüfung ist jederzeit möglich.")) {
              void props.onSubmit({ action: "reject", reviewerName: name, reviewNote: note || null, reviewChecklist: checked });
            }
          }}
          className="gap-1.5"
        >
          {props.busy === "reject" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
          Ablehnen
        </DtPillButton>
      </div>
    </div>
  );
}

function UploadBox(props: { run: GroundingRunDetail; busy: boolean; onMarkUploaded: (url: string) => Promise<boolean> }) {
  const { run } = props;
  const [url, setUrl] = useState(run.groundingUrl ?? run.factModel?.pageUrl ?? "");
  const base = `/api/dt/seo/grounding/runs/${run.id}/download`;
  return (
    <div className="grid gap-3 rounded-xl border border-sbkm-mint/60 bg-sbkm-mint/10 p-3">
      <p className="text-xs text-sbkm-navy dark:text-white">
        Freigegeben am {formatDay(run.reviewedAt)} von {run.reviewerName ?? "—"}. Beide Dateien herunterladen und von Hand auf der Website
        hochladen: grounding.html unter der Grounding-URL, llms.txt im Stammverzeichnis.
      </p>
      <div className="flex flex-wrap gap-2">
        <DtPillButton asChild size="sm" variant="outline" className="gap-1.5">
          <a href={`${base}?file=html`}>
            <Download className="size-4" aria-hidden />
            grounding.html
          </a>
        </DtPillButton>
        <DtPillButton asChild size="sm" variant="outline" className="gap-1.5">
          <a href={`${base}?file=llms`}>
            <Download className="size-4" aria-hidden />
            llms.txt
          </a>
        </DtPillButton>
      </div>
      {run.status === "approved" ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>Adresse der hochgeladenen Seite</span>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} className={INPUT_CLASS} placeholder="https://…/grounding/" />
          </label>
          <DtPillButton type="button" size="sm" disabled={props.busy || !url.trim()} onClick={() => void props.onMarkUploaded(url.trim())} className="gap-1.5">
            {props.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            Als hochgeladen markieren
          </DtPillButton>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-sbkm-navy dark:text-sbkm-mint">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Hochgeladen am {formatDay(run.uploadedAt)}
          {run.uploadedUrl ? ` · ${run.uploadedUrl}` : ""}. Die nächste Aktualisierung ist in drei Monaten fällig.
        </p>
      )}
    </div>
  );
}

export function DtSeoGroundingCheckDetail(props: {
  run: GroundingRunDetail;
  canEdit: boolean;
  viewerName: string;
  onRun: (run: GroundingRunDetail) => void;
  onUploaded?: () => void;
}) {
  const { run } = props;
  const [busy, setBusy] = useState<string | null>(null);

  const send = useMemo(
    () =>
      async (path: string, method: "PATCH" | "POST", body: Record<string, unknown>, busyKey: string, success: string): Promise<boolean> => {
        setBusy(busyKey);
        try {
          const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const json = (await res.json().catch(() => ({}))) as RunResponse;
          if (!res.ok || !json.ok || !json.run) {
            toast.error(json.message ?? "Speichern fehlgeschlagen.");
            return false;
          }
          props.onRun(json.run);
          toast.success(success);
          return true;
        } catch {
          toast.error("Speichern fehlgeschlagen.");
          return false;
        } finally {
          setBusy(null);
        }
      },
    [props],
  );

  const patch = (body: Record<string, unknown>) => {
    const action = String(body.action);
    const success =
      action === "approve" ? "Freigegeben – Dateien können heruntergeladen werden." : action === "reject" ? "Entwurf abgelehnt." : "Entwurf gespeichert.";
    return send(`/api/dt/seo/grounding/runs/${run.id}`, "PATCH", body, action, success);
  };

  const editable = props.canEdit && run.status === "draft";
  const generated = run.decision === "create" || run.decision === "update_required";
  const hasDraft = Boolean(run.draftHtml);

  return (
    <div className="grid gap-4">
      {run.hints.decisionReasons.length > 0 ? (
        <ul className="grid gap-1 text-sm text-sbkm-navy dark:text-white">
          {run.hints.decisionReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <DiffView run={run} />
      <OpenPoints run={run} />
      <Hints run={run} />
      <CrawledPages run={run} />

      {hasDraft ? (
        <div className="grid gap-3">
          <p className={LABEL_CLASS}>Entwurf</p>
          {run.hints.refreshChanges.length > 0 ? (
            <p className="text-xs text-sbkm-ink-600 dark:text-white/55">Nur Daten aufgefrischt: {run.hints.refreshChanges.join(" · ")}</p>
          ) : null}
          <ValidationList validation={run.validation} />
          {editable && generated ? <FactSwitches run={run} disabled={busy != null} onApply={patch} /> : null}
          <DraftEditor run={run} editable={editable} busy={busy === "save"} onSave={patch} />
        </div>
      ) : null}

      {editable && hasDraft ? <ReviewForm run={run} viewerName={props.viewerName} busy={busy} onSubmit={patch} /> : null}
      {run.status === "approved" || run.status === "uploaded" ? (
        <UploadBox
          run={run}
          busy={busy === "upload"}
          onMarkUploaded={async (url) => {
            const ok = await send(`/api/dt/seo/grounding/runs/${run.id}/mark-uploaded`, "POST", { url }, "upload", "Als hochgeladen markiert – der Rhythmus startet neu.");
            if (ok) props.onUploaded?.();
            return ok;
          }}
        />
      ) : null}
      {run.status === "rejected" && run.reviewNote ? (
        <p className="text-xs text-sbkm-ink-600 dark:text-white/55">Abgelehnt: {run.reviewNote}</p>
      ) : null}
    </div>
  );
}
