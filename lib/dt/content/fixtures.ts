/**
 * Demo data for `/api/dt/content/*` when CONTENT_AGENT_URL is not set (Vercel preview).
 * Shapes follow the Content-Agent contract in `types.ts`. Nothing here is persisted.
 */

import { formatEur } from "@/lib/dt/content/presentation";
import type {
  ContentAction,
  ContentClientPutBody,
  ContentClientPutResult,
  ContentClientQuestion,
  ContentExportFormat,
  ContentFinding,
  ContentJob,
  ContentLocalSources,
  ContentOverview,
  ContentPageRunThroughResult,
  ContentPageSummary,
  ContentQuestion,
  ContentReadiness,
  ContentReview,
  ContentRunThroughResult,
  ContentStep,
} from "@/lib/dt/content/types";

export const DEMO_STEP_NAMES = [
  "Recherche",
  "Gliederung",
  "Rohtext",
  "Faktencheck",
  "Tonalität & Avatar",
  "SEO-Feinschliff",
  "Lektorat",
  "Endabnahme",
] as const;

const DEMO_STEP_COST = [0.08, 0.06, 0.34, 0.18, 0.22, 0.27, 0.31, 0.14];

const HOURS = 60 * 60 * 1000;

function hoursAgo(h: number, now: number): string {
  return new Date(now - h * HOURS).toISOString();
}

function demoPages(now: number): ContentPageSummary[] {
  return [
    {
      name: "Startseite",
      slug: "startseite",
      level: 0,
      main_keyword: "Entrümpelung Düsseldorf",
      started: true,
      state: "fertig",
      label: "Fertig",
      detail: "Freigegeben",
      step: 8,
      cost_eur: 1.6,
      cost: "1,60 €",
      questions: 0,
      released: true,
      updated_at: hoursAgo(50, now),
    },
    {
      name: "Haushaltsauflösung",
      slug: "haushaltsaufloesung",
      level: 1,
      main_keyword: "Haushaltsauflösung Düsseldorf",
      started: true,
      state: "braucht_sie",
      label: "Braucht Sie",
      detail: "Zwei Fragen an den Kunden, bevor es weitergeht",
      step: 4,
      cost_eur: 0.92,
      cost: "0,92 €",
      questions: 2,
      updated_at: hoursAgo(3, now),
    },
    {
      name: "Kellerentrümpelung",
      slug: "kellerentruempelung",
      level: 1,
      main_keyword: "Keller entrümpeln Düsseldorf",
      started: true,
      state: "laeuft",
      label: "Läuft",
      detail: "Text wird geschrieben",
      step: 3,
      cost_eur: 0.41,
      cost: "0,41 €",
      questions: 0,
      updated_at: hoursAgo(0.1, now),
    },
    {
      name: "Wohnungsauflösung nach Todesfall",
      slug: "wohnungsaufloesung-todesfall",
      level: 2,
      main_keyword: "Wohnungsauflösung Todesfall Düsseldorf",
      started: true,
      state: "in_arbeit",
      label: "In Arbeit",
      detail: "Pausiert nach dem Faktencheck",
      step: 5,
      cost_eur: 1.12,
      cost: "1,12 €",
      questions: 0,
      updated_at: hoursAgo(26, now),
    },
    {
      name: "Über uns",
      slug: "ueber-uns",
      level: 1,
      main_keyword: "Entrümpelungsfirma Düsseldorf",
      started: true,
      state: "fertig",
      label: "Fertig",
      detail: "Wartet auf Freigabe",
      step: 8,
      cost_eur: 1.38,
      cost: "1,38 €",
      questions: 0,
      released: false,
      updated_at: hoursAgo(7, now),
    },
    {
      name: "Messie-Wohnung räumen",
      slug: "messie-wohnung",
      level: 2,
      main_keyword: "Messie Wohnung räumen Düsseldorf",
      started: false,
      state: "nicht_begonnen",
      label: "Nicht begonnen",
      detail: null,
      step: null,
      cost_eur: 0,
      cost: "0,00 €",
      questions: 0,
      updated_at: null,
    },
    {
      name: "Gewerbeentrümpelung",
      slug: "gewerbeentruempelung",
      level: 1,
      main_keyword: "Gewerbe entrümpeln Düsseldorf",
      started: false,
      state: "nicht_begonnen",
      label: "Nicht begonnen",
      detail: null,
      step: null,
      cost_eur: 0,
      cost: "0,00 €",
      questions: 0,
      updated_at: null,
    },
  ];
}

/** Demo readiness mirrors what DigitalTwin actually has for this organisation. */
export function demoReadiness(local: ContentLocalSources): ContentReadiness {
  const checks: ContentReadiness["checks"] = [
    {
      id: "anbieter",
      ok: Boolean(local.anbieter),
      label: "Anbieterfakten",
      hint: local.anbieter
        ? `Aus „${local.anbieter.surveyTitle}“ übernommen.`
        : "Kein abgeschlossener Anbieter-Fragebogen gefunden.",
    },
    {
      id: "avatar",
      ok: local.avatarCount > 0,
      label: "Avatar",
      hint:
        local.avatarCount > 0
          ? `${local.avatarCount} Avatar${local.avatarCount === 1 ? "" : "e"} verfügbar.`
          : "Noch kein Avatar für diese Organisation angelegt.",
    },
    {
      id: "structure",
      ok: Boolean(local.structure),
      label: "Webseitenstruktur-Excel",
      hint: local.structure
        ? `Struktur „${local.structure.filename ?? "ohne Dateiname"}“ hinterlegt.`
        : "Die Seitenliste (Excel) fehlt noch.",
    },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

const DEMO_LOCAL_SOURCES: ContentLocalSources = {
  anbieter: { surveyTitle: "Anbieter-Fragebogen" },
  avatarCount: 1,
  structure: { filename: "webseitenstruktur.xlsx" },
};

export function demoOverview(
  local: ContentLocalSources = DEMO_LOCAL_SOURCES,
  now = Date.now(),
): ContentOverview {
  const pages = demoPages(now);
  const costEur = Math.round(pages.reduce((sum, p) => sum + p.cost_eur, 0) * 100) / 100;
  return {
    readiness: demoReadiness(local),
    pages,
    needs_you: pages.filter((p) => p.state === "braucht_sie").length,
    finished: pages.filter((p) => p.state === "fertig").length,
    running: pages.filter((p) => p.state === "laeuft").length,
    cost_eur: costEur,
    cost: formatEur(costEur),
  };
}

function demoSteps(page: ContentPageSummary): ContentStep[] {
  return DEMO_STEP_NAMES.map((name, index) => {
    const step = index + 1;
    const current = page.step ?? 0;
    let status: ContentStep["status"] = "pending";
    if (page.state === "fertig") {
      status = step === 8 && !page.released ? "waiting" : "done";
    } else if (step < current) {
      status = "done";
    } else if (step === current) {
      status = page.state === "laeuft" ? "running" : "waiting";
    }
    const exists = status === "done" || status === "waiting";
    return { step, name, status, exists, cost_eur: exists ? DEMO_STEP_COST[index]! : 0 };
  });
}

function demoHtml(page: ContentPageSummary): string {
  const kw = page.main_keyword ?? page.name;
  return [
    `<section data-block-id="intro"><h1>${kw}: schnell, besenrein, zum Festpreis</h1>`,
    `<p>Sie möchten in Düsseldorf Platz schaffen, ohne sich um etwas kümmern zu müssen? Wir übernehmen alles: von der Besichtigung über das Sortieren bis zur besenreinen Übergabe. Sie bekommen vorher einen verbindlichen Festpreis – ohne versteckte Kosten.</p></section>`,
    `<section data-block-id="ablauf"><h2>So läuft es ab</h2><ol><li>Kostenlose Besichtigung vor Ort oder per Video</li><li>Schriftliches Festpreisangebot innerhalb von 24 Stunden</li><li>Räumung zum Wunschtermin, auch kurzfristig</li><li>Besenreine Übergabe mit Protokoll</li></ol></section>`,
    `<section data-block-id="vorteile"><h2>Warum Kunden uns wählen</h2><p>Seit 2012 haben wir über 1.800 Aufträge in Düsseldorf und Umgebung erledigt. Gut erhaltene Möbel geben wir an soziale Einrichtungen weiter, der Rest wird fachgerecht entsorgt. Wertgegenstände rechnen wir auf Wunsch an.</p></section>`,
    `<section data-block-id="faq"><h2>Häufige Fragen</h2><h3>Wie schnell können Sie kommen?</h3><p>In der Regel innerhalb von drei Werktagen, in dringenden Fällen auch am nächsten Tag.</p><h3>Was kostet das?</h3><p>Das hängt von Menge und Zugang ab. Nach der Besichtigung nennen wir Ihnen einen Festpreis.</p></section>`,
    `<section data-block-id="cta"><h2>Jetzt unverbindlich anfragen</h2><p>Rufen Sie uns an oder schreiben Sie uns über WhatsApp – wir melden uns noch am selben Tag.</p></section>`,
  ].join("\n");
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1>(.*?)<\/h1>/g, "# $1\n\n")
    .replace(/<h2>(.*?)<\/h2>/g, "## $1\n\n")
    .replace(/<h3>(.*?)<\/h3>/g, "### $1\n\n")
    .replace(/<li>(.*?)<\/li>/g, "- $1\n")
    .replace(/<p>(.*?)<\/p>/g, "$1\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const DEMO_FINDINGS: ContentFinding[] = [
  {
    title: "Zahl nicht belegt",
    problem: "„über 1.800 Aufträge“ steht nicht in den Anbieterfakten.",
    proposal: "Zahl vom Kunden bestätigen lassen oder durch „viele hundert Aufträge“ ersetzen.",
    severity: "high",
    severity_label: "Wichtig",
    block_id: "vorteile",
  },
  {
    title: "Anrede uneinheitlich",
    problem: "Im Abschnitt „So läuft es ab“ wechselt der Text kurz ins Du.",
    proposal: "Durchgehend „Sie“ verwenden, wie im Fragebogen angegeben.",
    severity: "medium",
    severity_label: "Mittel",
    block_id: "ablauf",
  },
  {
    title: "Hauptbegriff selten",
    problem: "Der Suchbegriff kommt nur einmal im Fließtext vor.",
    proposal: "Im ersten Absatz und in einer Zwischenüberschrift ergänzen.",
    severity: "low",
    severity_label: "Hinweis",
    block_id: "intro",
  },
];

const DEMO_QUESTIONS: ContentQuestion[] = [
  {
    kind: "fact",
    question: "Stimmt die Zahl „über 1.800 Aufträge seit 2012“?",
    field: "proven_metrics",
    placeholder: "z. B. „rund 1.500 Aufträge“",
    block_id: "vorteile",
    excerpt: "Seit 2012 haben wir über 1.800 Aufträge in Düsseldorf und Umgebung erledigt.",
    blocking: true,
  },
  {
    kind: "fact",
    question: "Werden Wertgegenstände wirklich angerechnet – auch bei Haushaltsauflösungen?",
    field: null,
    placeholder: "Ja / Nein / nur ab bestimmtem Wert",
    block_id: "vorteile",
    excerpt: "Wertgegenstände rechnen wir auf Wunsch an.",
    blocking: true,
  },
];

function demoActions(page: ContentPageSummary): ContentAction[] {
  switch (page.state) {
    case "nicht_begonnen":
      return [{ kind: "run_through", label: "Weiterlaufen lassen" }];
    case "laeuft":
      return [];
    case "braucht_sie":
      return [
        { kind: "approve", step: 4, label: "Freigeben" },
        { kind: "edit", step: 4, label: "Abschnitt ändern" },
        { kind: "rerun_with_note", step: 4, label: "Mit Anmerkung wiederholen" },
        { kind: "export", label: "Exportieren" },
      ];
    case "in_arbeit":
      return [
        { kind: "run_through", label: "Weiterlaufen lassen" },
        { kind: "rerun_with_note", step: 4, label: "Mit Anmerkung wiederholen" },
        { kind: "export", label: "Exportieren" },
      ];
    case "fertig":
      return page.released
        ? [{ kind: "export", label: "Exportieren" }]
        : [
            { kind: "approve", step: 8, label: "Freigeben" },
            { kind: "edit", step: 7, label: "Abschnitt ändern" },
            { kind: "rerun_with_note", step: 7, label: "Mit Anmerkung wiederholen" },
            { kind: "export", label: "Exportieren" },
          ];
    default:
      return [];
  }
}

export function demoReview(slug: string, now = Date.now()): ContentReview | null {
  const page = demoPages(now).find((p) => p.slug === slug);
  if (!page) return null;
  const hasText = page.started && page.state !== "laeuft";
  const html = hasText ? demoHtml(page) : "";
  const needsYou = page.state === "braucht_sie";
  const findings =
    needsYou ? DEMO_FINDINGS : page.state === "in_arbeit" ? DEMO_FINDINGS.slice(1) : [];
  return {
    name: page.name,
    public: {
      state: page.state,
      label: page.label,
      detail: page.detail,
      step: page.step,
      cost: page.cost,
      released: page.released,
    },
    text_step: hasText ? Math.min(page.step ?? 3, 7) : null,
    markdown: htmlToMarkdown(html),
    html,
    findings,
    final_findings: page.state === "fertig" ? [] : findings.filter((f) => f.severity === "high"),
    unresolved: [],
    questions: needsYou ? DEMO_QUESTIONS : [],
    steps: demoSteps(page),
    actions: demoActions(page),
  };
}

export function demoQuestions(now = Date.now()): { questions: ContentClientQuestion[] } {
  const questions: ContentClientQuestion[] = [];
  for (const page of demoPages(now)) {
    const review = demoReview(page.slug, now);
    for (const q of review?.questions ?? []) {
      questions.push({ ...q, page: page.name, slug: page.slug });
    }
  }
  return { questions };
}

export function demoRunThrough(
  input: { pages?: string[]; all?: boolean },
  now = Date.now(),
): ContentRunThroughResult {
  const pages = demoPages(now);
  const wanted = input.all ? pages : pages.filter((p) => input.pages?.includes(p.slug));
  const result: ContentRunThroughResult = { jobs: [], skipped: [] };
  for (const page of wanted) {
    if (page.state === "fertig" && page.released) {
      result.skipped.push({ page: page.name, reason: "Bereits freigegeben" });
      continue;
    }
    if (page.state === "laeuft") {
      result.skipped.push({ page: page.name, reason: "Läuft bereits" });
      continue;
    }
    const id = `demo-${page.slug}`;
    result.jobs.push({
      id,
      slug: page.slug,
      page: page.name,
      state: "running",
      status_url: `/api/v1/jobs/${id}`,
    });
  }
  return result;
}

export function demoPageRunThrough(slug: string): ContentPageRunThroughResult {
  const id = `demo-${slug}`;
  return { id, status_url: `/api/v1/jobs/${id}` };
}

export function demoJob(): ContentJob {
  return { state: "done", result: { demo: true }, error: null };
}

export function demoPutClient(clientKey: string, body: ContentClientPutBody): ContentClientPutResult {
  const problems: string[] = [];
  if (body.anbieter && !String(body.anbieter.name ?? "").trim()) {
    problems.push("Anbieter: Firmenname fehlt.");
  }
  if (body.anbieter && !String(body.anbieter.branche ?? "").trim()) {
    problems.push("Anbieter: Branche fehlt.");
  }
  return {
    client: clientKey,
    anbieter: Boolean(body.anbieter),
    avatar: Boolean(body.avatar),
    structure: "webseitenstruktur.xlsx",
    complete: Boolean(body.anbieter && body.avatar) && problems.length === 0,
    problems,
  };
}

export function demoExport(
  slug: string,
  format: ContentExportFormat,
  now = Date.now(),
): { body: string; filename: string; contentType: string } | null {
  const review = demoReview(slug, now);
  if (!review || !review.html) return null;
  if (format === "md") {
    return {
      body: review.markdown,
      filename: `${slug}.md`,
      contentType: "text/markdown; charset=utf-8",
    };
  }
  if (format === "fragment") {
    return { body: review.html, filename: `${slug}.fragment.html`, contentType: "text/html; charset=utf-8" };
  }
  return {
    body: `<!DOCTYPE html>\n<html lang="de">\n<head><meta charset="utf-8"><title>${review.name}</title></head>\n<body>\n${review.html}\n</body>\n</html>\n`,
    filename: `${slug}.html`,
    contentType: "text/html; charset=utf-8",
  };
}
