import { createServiceClient } from "@/lib/supabase/service";
import {
  DT_GROUNDING_PAGE_SELECT,
  buildGroundingPageUpdate,
  serializeGroundingPage,
  type DtGroundingPagePatch,
} from "@/lib/dt/seo/grounding-pages";
import { answerGroundingQuestions, startGroundingRun } from "@/lib/dt/seo/grounding-run/actions";
import { reconcileGroundingPages } from "@/lib/dt/seo/grounding-run/health";
import { groundingRunQuestions } from "@/lib/dt/seo/grounding-run/store";
import { groundingStepLabel } from "@/lib/dt/seo/grounding-run/steps";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import type { DtGroundingPageRow } from "@/lib/dt/types";

export type DtGroundingPageToolInput = {
  url: string;
  kind?: "hub" | "entity";
  entityName?: string | null;
  slug?: string | null;
  status?: "draft" | "approved" | "Entwurf" | "freigegeben";
  dateModified?: string | null;
  lastReviewed?: string | null;
  reviewedBy?: string | null;
  standardVersion?: string | null;
  uploadedAt?: string | null;
  note?: string | null;
};

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

/**
 * "Rückgabe an das Tool": the GEO agent reports a page's state (URL, status,
 * dateModified, lastReviewed, reviewer, standard version). Upserts by URL.
 * lastReviewed/reviewedBy only count once the user documented the approval.
 */
export async function updateGroundingPageForTool(
  organisationId: string,
  input: DtGroundingPageToolInput,
): Promise<string> {
  const url = normalizeUrl(String(input.url ?? ""));
  if (!url) return "url fehlt oder ist ungültig (http/https).";

  const supabase = createServiceClient();
  const { data: rows, error: loadError } = await supabase
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("organisation_id", organisationId);
  if (loadError) return `Fehler beim Laden: ${loadError.message}`;

  const pages = (rows ?? []) as DtGroundingPageRow[];
  const stripSlash = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const existing =
    pages.find((p) => stripSlash(p.url) === stripSlash(url)) ?? null;
  const hasHub = pages.some((p) => p.kind === "hub");

  const status =
    input.status === "approved" || input.status === "freigegeben"
      ? ("approved" as const)
      : input.status === "draft" || input.status === "Entwurf"
        ? ("draft" as const)
        : undefined;

  const patch: DtGroundingPagePatch = {
    url,
    entityName: input.entityName ?? undefined,
    slug: input.slug ?? undefined,
    dateModified: input.dateModified ?? undefined,
    lastReviewed: input.lastReviewed ?? undefined,
    reviewedBy: input.reviewedBy ?? undefined,
    standardVersion: input.standardVersion ?? undefined,
    uploadedAt: input.uploadedAt ?? undefined,
  };
  if (status === "draft") {
    // Draft: a page without documented review never carries review data.
    patch.reviewStatus = "draft";
    patch.lastReviewed = null;
    patch.reviewedBy = null;
  } else if (status === "approved") {
    patch.reviewStatus = "approved";
  }
  if (input.note?.trim()) {
    const prev = (existing?.notes ?? "").trim();
    const line = `Agent (${new Date().toISOString().slice(0, 10)}): ${input.note.trim()}`;
    patch.notes = prev ? `${prev}\n${line}` : line;
  }
  if (!existing) {
    patch.kind = input.kind ?? (hasHub ? "entity" : "hub");
    if (patch.kind === "hub" && hasHub) {
      return "Es gibt bereits einen Hub für diese Organisation. Entitätsseiten mit kind \"entity\" melden.";
    }
  } else if (input.kind && input.kind !== existing.kind) {
    if (input.kind === "hub" && hasHub) {
      return "Es gibt bereits einen Hub. Die Art einer bestehenden Seite kann nicht auf hub geändert werden.";
    }
    patch.kind = input.kind;
  }

  const built = buildGroundingPageUpdate(patch, existing);
  if (!built.ok) return built.message;

  const query = existing
    ? supabase.from("dt_grounding_pages").update(built.update).eq("id", existing.id)
    : supabase.from("dt_grounding_pages").insert({
        organisation_id: organisationId,
        position: pages.length,
        ...built.update,
      });
  const { data, error } = await query.select(DT_GROUNDING_PAGE_SELECT).maybeSingle();
  if (error || !data) return `Speichern fehlgeschlagen: ${error?.message ?? "unbekannt"}`;

  const view = serializeGroundingPage(data as DtGroundingPageRow);
  return [
    existing ? "Grounding Page im Tool aktualisiert." : "Grounding Page im Tool angelegt.",
    `URL: ${view.url}`,
    `Art: ${view.kind === "hub" ? "Hub" : `Entitätsseite${view.entityName ? ` „${view.entityName}“` : ""}`}`,
    `Status: ${view.reviewStatus === "approved" ? "freigegeben" : "Entwurf"} · Standard v${view.standardVersion ?? "?"}`,
    `dateModified: ${dayOf(view.dateModified)} · lastReviewed: ${dayOf(view.lastReviewed)} · Prüfer: ${view.reviewedBy ?? "—"}`,
    `Nächste Fälligkeit: ${dayOf(view.schedule.nextDueAt)} (${view.schedule.basisLabel})`,
  ].join("\n");
}


// ---------------------------------------------------------------------------
// Grounding agent from the chat: start a draft, pass the customer's answers on.
// ---------------------------------------------------------------------------

export type DtStartGroundingDraftInput = {
  kind: "hub" | "entity";
  url: string;
  entityName?: string | null;
  slug?: string | null;
};

const STEP_HINT =
  "Der Agent arbeitet im Hintergrund (1 Fakten sammeln, 2 Faktencheck, 3 Seite bauen, 4 Endprüfung), meist 5–15 Minuten. Der Stand steht in deinem Kontext unter „Grounding Pages (Tool-Kontext)“ und im Tab Grounding; die HTML-Datei liegt dort am Ende zum Download.";

function questionsText(page: DtGroundingPageRow): string {
  const questions = groundingRunQuestions(page);
  if (questions.length === 0) return "";
  return [
    "Fragen, die nur der Nutzer beantworten kann:",
    ...questions.map((q, i) => `${i + 1}. ${q.question}${q.placeholder ? ` (z. B. ${q.placeholder})` : ""}`),
    "Antworten mit answer_grounding_draft weitergeben.",
  ].join("\n");
}

async function loadPagesForOrg(organisationId: string): Promise<{ pages: DtGroundingPageRow[]; error: string | null }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("organisation_id", organisationId);
  if (error) return { pages: [], error: `Fehler beim Laden: ${error.message}` };
  return { pages: (data ?? []) as DtGroundingPageRow[], error: null };
}

function findByUrl(pages: DtGroundingPageRow[], url: string): DtGroundingPageRow | null {
  const strip = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  return pages.find((p) => strip(p.url) === strip(url)) ?? null;
}

/**
 * „Entwurf erstellen“ from the chat. Creates the page row when the URL is new (one Hub
 * per organisation; a second Hub URL reuses the existing Hub), then starts or continues
 * the four-step run. Never restarts a finished draft on its own.
 */
export async function startGroundingDraftForTool(
  organisationId: string,
  input: DtStartGroundingDraftInput,
): Promise<string> {
  const url = normalizeUrl(String(input.url ?? ""));
  if (!url) return "url fehlt oder ist ungültig (http/https).";
  const supabase = createServiceClient();
  const { pages, error } = await loadPagesForOrg(organisationId);
  if (error) return error;

  let page = findByUrl(pages, url);
  if (!page && input.kind === "hub") {
    page = pages.find((p) => p.kind === "hub") ?? null;
    if (page) {
      return `Es gibt bereits einen Hub unter ${page.url}. Für eine andere Hub-URL bitte den Nutzer im Tab Grounding entscheiden lassen; ich starte keinen zweiten Hub.`;
    }
  }
  if (!page) {
    const built = buildGroundingPageUpdate(
      {
        kind: input.kind,
        url,
        entityName: input.kind === "entity" ? (input.entityName ?? null) : undefined,
        slug: input.kind === "entity" ? (input.slug ?? null) : undefined,
      },
      null,
    );
    if (!built.ok) return built.message;
    const { data, error: insertError } = await supabase
      .from("dt_grounding_pages")
      .insert({ organisation_id: organisationId, position: pages.length, ...built.update })
      .select(DT_GROUNDING_PAGE_SELECT)
      .maybeSingle();
    if (insertError || !data) return `Seite konnte nicht angelegt werden: ${insertError?.message ?? "unbekannt"}`;
    page = data as DtGroundingPageRow;
  }

  const name = page.kind === "hub" ? "Hub" : `Entitätsseite „${page.entity_name ?? page.slug ?? page.url}“`;
  switch (page.run_state) {
    case "laeuft":
      return `Der Entwurf für ${name} läuft bereits (${groundingStepLabel(page.run_step ?? 1)}). ${STEP_HINT}`;
    case "braucht_sie":
      return `Der Entwurf für ${name} wartet auf Antworten.\n${questionsText(page)}`;
    case "fertig":
      return `Der Entwurf für ${name} ist fertig; die HTML-Datei liegt im Tab Grounding zum Download. Eine neue Fassung startet der Nutzer dort mit „Neu erstellen“ oder „Mit Anmerkung neu bauen“.`;
    default: {
      const started = await startGroundingRun(supabase, page, null);
      if (!started.ok) return started.message;
      if (started.jobId) kickJobsWorker(1);
      const resumed = page.run_state === "in_arbeit";
      return `${resumed ? "Entwurf wird fortgesetzt" : "Entwurf gestartet"}: ${name} unter ${page.url}. ${STEP_HINT}`;
    }
  }
}

/** The customer's answers to the Faktencheck questions, then the run continues with „Seite bauen“. */
export async function answerGroundingDraftForTool(
  organisationId: string,
  input: { url: string; answers: string },
): Promise<string> {
  const url = normalizeUrl(String(input.url ?? ""));
  if (!url) return "url fehlt oder ist ungültig (http/https).";
  const { pages, error } = await loadPagesForOrg(organisationId);
  if (error) return error;
  const page = findByUrl(pages, url);
  if (!page) return `Keine Grounding Page mit der URL ${url} im Tool.`;
  if (page.run_state !== "braucht_sie") {
    return `Der Entwurf für ${page.url} wartet gerade nicht auf Antworten (Stand: ${page.run_state}).`;
  }
  const supabase = createServiceClient();
  const result = await answerGroundingQuestions(supabase, page, String(input.answers ?? ""), null);
  if (!result.ok) return result.message;
  if (result.jobId) kickJobsWorker(1);
  return `Antworten gespeichert. Der Agent baut jetzt die Seite (Schritt 3) und prüft sie (Schritt 4). ${STEP_HINT}`;
}

/**
 * The user asked for the finished HTML file inside the chat. Writing that file in the
 * chat turn blows the request and the client only sees a network error. Answer from the
 * draft state instead and keep the background agent moving.
 */
function urlInText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)>\]]+/i);
  return match?.[0]?.replace(/[.,;]+$/, "") ?? null;
}

function groundingTabHref(organisationId: string): string {
  return `/dashboard/verwaltung/seo?org=${encodeURIComponent(organisationId)}&tab=grounding`;
}

export async function answerGroundingHtmlRequest(
  organisationId: string,
  userId: string,
  text: string,
): Promise<string> {
  const tab = groundingTabHref(organisationId);
  const supabase = createServiceClient();
  const loaded = await loadPagesForOrg(organisationId);
  if (loaded.error) return loaded.error;

  let pages = loaded.pages;
  try {
    pages = (await reconcileGroundingPages(supabase, pages)).pages;
  } catch (err) {
    console.warn(
      "[grounding] html request reconcile:",
      err instanceof Error ? err.message : err,
    );
  }

  const wanted = urlInText(text);
  const page = (wanted ? findByUrl(pages, wanted) : null) ?? pages.find((p) => p.kind === "hub") ?? null;
  if (!page) {
    return `Es ist noch keine Grounding Page hinterlegt. Im Tab Grounding die Hub-URL anlegen, dann startet der Entwurf. [Grounding öffnen](${tab})`;
  }

  const name = page.kind === "hub" ? "Hub" : `Entitätsseite „${page.entity_name ?? page.slug ?? page.url}“`;
  const link = `[Grounding öffnen](${tab})`;
  const where = `Die Datei liegt im Tab Grounding zum Download, sobald die Endprüfung durch ist. ${link}`;

  if (page.run_state === "laeuft") {
    kickJobsWorker(1);
    return `Der Entwurf für ${name} läuft (${groundingStepLabel(page.run_step ?? 1)}). Die HTML-Datei entsteht dort im Hintergrund, Schritt für Schritt. ${where}`;
  }
  if (page.run_state === "braucht_sie") {
    return `Der Entwurf für ${name} wartet auf Antworten, danach baut der Agent die HTML-Datei.\n${questionsText(page)}\n${where}`;
  }
  if (page.run_state === "fertig") {
    return `Die HTML-Datei für ${name} ist fertig und liegt im Tab Grounding zum Download. ${link}`;
  }

  const started = await startGroundingRun(supabase, page, userId);
  if (!started.ok) return started.message;
  if (started.jobId) kickJobsWorker(1);
  const resumed = page.run_state === "in_arbeit";
  return resumed
    ? `Der unterbrochene Entwurf für ${name} läuft weiter (${page.url}). ${where}`
    : `Der Entwurf für ${name} ist gestartet (${page.url}). ${where}`;
}
