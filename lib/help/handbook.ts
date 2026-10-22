/**
 * DigitalTwin-Hilfe: das Handbuch, das der Hilfe-Assistent kennt.
 * Quelle ist das README; hier in kurzer, rollengefilterter Form.
 * Pure module (no server imports) so client and tests can use the route map.
 */

import {
  DT_ONBOARDING_SUPPORT_EMAIL,
  DT_ONBOARDING_SWITCHBOARD_PHONE,
} from "@/lib/dt/onboarding/copy";

/** Who may read a section. "manager" = Inhaber / Firmen-Admin (Agenten verwalten). */
export type HelpAudience = "all" | "manager" | "admin";

export type HelpRole = {
  isPlatformAdmin: boolean;
  canManageDtAgents: boolean;
};

export type HelpSection = {
  id: string;
  title: string;
  audience: HelpAudience;
  lines: string[];
};

export function helpRoleLabel(role: HelpRole): string {
  if (role.isPlatformAdmin) return "Plattform-Admin (Sichtbarkeitsmeister-Team)";
  if (role.canManageDtAgents) return "Firmeninhaber oder Firmen-Admin";
  return "Mitglied einer Firma";
}

export function audienceAllowed(audience: HelpAudience, role: HelpRole): boolean {
  if (audience === "all") return true;
  if (audience === "manager") return role.isPlatformAdmin || role.canManageDtAgents;
  return role.isPlatformAdmin;
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "overview",
    title: "Was DigitalTwin ist",
    audience: "all",
    lines: [
      "DigitalTwin ist die Web-App von Sichtbarkeitsmeister für Kundenfirmen. Eine Organisation ist eine Kundenfirma.",
      "Je Firma gibt es: einen Chat mit KI-Figuren (Avatare der Wunschkunden, Team, SEO-Berater), Fragebögen, aus denen Avatare entstehen, ein Onboarding zum Einsammeln von Unterlagen und Zugängen, und E-Mails (Einladungen, Hinweise).",
      "Die KI heißt Claude und kommt von Anthropic. Die Avatare sprechen als Interessenten (Wunschkunden), nicht als Mitarbeiter der Firma.",
      "Nach dem Login landet man auf /dashboard/organisations. Die Startseite / zeigt eingeloggten Mitgliedern den Chat.",
    ],
  },
  {
    id: "roles",
    title: "Wer darf was",
    audience: "all",
    lines: [
      "Plattform-Admins sind das Sichtbarkeitsmeister-Team. Sie sehen alle Firmen, den SEO-Modus, Texte, Token-Nutzung, Transkripte und den Admin-Bereich.",
      "Firmeninhaber (owner) und Firmen-Admins (admin) sehen zusätzlich „Agenten“ und können das Firmenprofil bearbeiten. Agenten direkt ändern darf nur ein Plattform-Admin; Anträge landen unter Agent-Anfragen. Firmenprofil-Änderungen erscheinen unter Firmenprofil-Änderungen.",
      "Mitglieder (employee) nutzen Chat, Posteingang, Onboarding, Firmenprofil und Ansprechpartner der eigenen Firma.",
      "Fehlt ein Menüpunkt, liegt das fast immer an der Rolle, nicht an einem Fehler. Rollen vergibt der Firmeninhaber unter Organisation oder das Sichtbarkeitsmeister-Team.",
      "Inhaber dürfen fertige SEO-Berichte lesen. Den SEO-Arbeitsplatz selbst bedient nur Sichtbarkeitsmeister.",
    ],
  },
  {
    id: "menu",
    title: "Menü und Wege (für alle)",
    audience: "all",
    lines: [
      "Chat mit den KI-Figuren: Startseite / oder /dashboard/digital-twin. Oben die Figur wählen (Avatar, Team, SEO-Berater). Dateien lassen sich anhängen; „Text“ schaltet den Textmodus für Flyer, Social-Posts und Infos ein.",
      "Posteingang: /dashboard/inbox — Einladung in eine Firma annehmen.",
      "Onboarding: /dashboard/onboarding — Unterlagen, Zugänge (Hoster, SMTP, CMS), Mitbewerber, IT-Kontakt und Medien einer Firma. Es gibt einen Upload-Link, den der Kunde ohne Login öffnen kann (/onboarding/upload/[token]).",
      "Ansprechpartner: /dashboard/ansprechpartner — Kontakte von Sichtbarkeitsmeister.",
      "Firmenprofil: /dashboard/firmenprofil — Stammdaten, Ansprechpartner des Kunden, USPs, Leistungen, Ziele und weitere Workshop-Punkte. Inhaber/Admins speichern direkt; Sichtbarkeitsmeister sieht die Änderungen.",
      "Organisation: /dashboard/organisations — Firma, Mitglieder, Einladungen. Eine Firma öffnen: /dashboard/organisations/[id].",
      "Persönliche Einstellungen: /settings — unter anderem Regeln für diesen Hilfe-Assistenten.",
      "Viele Seiten tragen die Firma in der Adresse als ?org=<id>. Fehlt die Firma, erscheint oben eine Auswahl oder die Seite bleibt leer.",
    ],
  },
  {
    id: "agents",
    title: "Agenten (Inhaber und Firmen-Admins)",
    audience: "manager",
    lines: [
      "Agenten: /dashboard/verwaltung/agents?org=<id> — alle KI-Figuren der Firma mit Rolle und Beschreibung.",
      "Änderungswunsch an einer Figur: dort „Änderung beantragen“. Der Antrag geht an Sichtbarkeitsmeister und wird dort freigegeben oder abgelehnt.",
      "Ein Avatar entsteht aus einem ausgefüllten Fragebogen: Antwort öffnen (/dashboard/surveys/[id]/responses/[id]) und „Avatar erzeugen“. Das läuft über die KI und kann einige Minuten dauern.",
    ],
  },
  {
    id: "admin-menu",
    title: "Menü für Plattform-Admins",
    audience: "admin",
    lines: [
      "Globale Prompts: /dashboard/verwaltung/globale-prompts — plattformweite Standard-Prompts (DigitalTwin, SEO-Berater), der Text-Prompt (erste Karte, allgemeine Regeln für jeden Seitentyp) und die globale SEO-Checkliste. Nur für Plattform-Admins.",
      "Agent-Kontext: /dashboard/verwaltung/agent-kontext?org=<id> — zeigt den zusammengebauten System-Prompt einer Figur mit allen Bausteinen (Wunschkunden-Wissen, Transkripte, Website-Struktur, Onboarding, Grounding). Intern, nie für Kunden.",
      "SEO Modus: /dashboard/verwaltung/seo?org=<id>&tab=<tab> — Tabs: chat (SEO-Berater mit Crawl-Werkzeugen und Websuche), stats (Statistik), tasks (Aufgaben-Board), reports (SEO-Reports, auch an den Inhaber senden), analyse (Crawl-Viewer, Indexierbarkeit), struktur (hochgeladene Website-Struktur), grounding (Grounding Pages), settings (Website-URL, Sitemap, Search Console, „Jetzt crawlen“, SEO-Checkliste).",
      "Texte: /dashboard/verwaltung/texte?org=<id> — Seitentexte in neun Schritten schreiben lassen, prüfen und freigeben. Unten auf der Seite steht der Text-Prompt (allgemeine Regeln, vollständig sichtbar) und darunter die sechs Textvorlagen. Derselbe Text-Prompt ist die erste Karte unter Globale Prompts.",
      "SEO: /dashboard/verwaltung/seo-text?org=<id> — eigenständiges Werkzeug: Seitenname, Seitentyp, Avatar wählen, optional eine Datei (.txt, .html, .pdf, .docx) als Material hochladen, „Text schreiben“. Ein KI-Aufruf mit der Anweisung aus Globale Prompts → SEO, den eigenen Textvorlagen (Karte unten auf der Seite, unabhängig von Texte), den Anbieterfakten und dem Avatar; Ergebnis als HTML oder .txt herunterladen. Braucht keine Einstellungen und keine Seitenstruktur aus Texte. Statt der Datei geht auch „Website crawlen“: derselbe Crawl wie in Texte, dann eine Seite aus der Tabelle wählen.",
      "GEO: /dashboard/verwaltung/geo?org=<id> — eigenständig: eine Datei (.txt, .html, .pdf, .docx) hochladen, optional Seitenname, Avatar wählen und „Verarbeiten“; der Text wird mit der Anweisung aus Globale Prompts → GEO, den Anbieterfakten und dem Avatar für KI-Zitate überarbeitet (ein bis drei Minuten). Ergebnis als HTML oder .txt herunterladen. Braucht keine Einstellungen aus Texte und keine Seitenstruktur. Statt der Datei geht auch „Website crawlen“: derselbe Crawl wie in Texte, dann eine Seite aus der Tabelle wählen.",
      "Hormozi: /dashboard/verwaltung/hormozi?org=<id> — eigenständig: eine Datei (.txt, .html, .pdf, .docx) hochladen, optional Seitenname, Seitentyp und Avatar wählen (Avatar ist Pflicht; ohne Avatar zuerst unter Agenten oder im Transkripte-Schritt einen anlegen) und „Verarbeiten“. Der Text bekommt mit der Anweisung aus Globale Prompts → Hormozi (dieselbe wie Schritt 5 in Texte), den Anbieterfakten und dem Avatar einen Hero-Satz, die Value Equation und geschärfte Handlungsaufforderungen; fehlende Kontaktwege, Preise oder Beweise stehen als [BITTE PRÜFEN: …] im Text. Die Seite zeigt die abgeleiteten Hormozi-Bausteine (Traumziel, Hauptschmerz, Größte Hürde, Beweis, Handlungsaufforderung) und den Text als HTML oder .txt zum Herunterladen. Braucht keine Einstellungen aus Texte und keine Seitenstruktur. Statt der Datei geht auch „Website crawlen“: derselbe Crawl wie in Texte, dann eine Seite aus der Tabelle wählen.",
      "Watermark Entfernung: /dashboard/verwaltung/watermark-entfernung — eigenständig, ohne Organisation und ohne Texte-Einstellungen: eine Datei (.txt, .html, .pdf, .docx) hochladen, jeder Satz wird auf Grok neu formuliert (wie Schritt 8 aus Texte; Überschriften, Fakten und Marker bleiben), dann als HTML oder .txt herunterladen. Braucht nur den Grok-Schlüssel XAI_API_KEY.",
      "Token-Nutzung: /dashboard/verwaltung/usage — Verbrauch je Firma, Nutzer, Agent und Tag, inklusive Websuchen und Kostenschätzung.",
      "Transkripte: /dashboard/transkripte — Gesprächsmitschriften auswerten und ins Wissen der Avatare und des SEO-Beraters übernehmen.",
      "Admin-Bereich: Agent-Anfragen /dashboard/admin/agent-requests (Anträge der Inhaber freigeben), Firmenprofil-Änderungen /dashboard/admin/company-edits (Kundenänderungen an Stammdaten/USPs sehen), Plattform-Übersicht /dashboard/admin/organisations (Firmen anlegen, archivieren, DigitalTwin und SEO ein- oder ausschalten), Plattform-Team /dashboard/admin/team, E-Mails /dashboard/admin/mails (Versandprotokoll), Alle Umfragen /dashboard/surveys.",
    ],
  },
  {
    id: "grounding",
    title: "Grounding Pages (SEO Modus, Tab Grounding)",
    audience: "admin",
    lines: [
      "Der Tab verwaltet je Firma den Hub (Haupt-Grounding-Page) und Entitätsseiten nach Grounding Page Standard v1.7, dazu die llms.txt der Domain.",
      "Fällig ist jede Seite drei Monate nach der letzten menschlichen Faktenprüfung (lastReviewed), Frühwarnung 14 Tage vorher. Ohne dokumentierte Prüfung zählt vorläufig das Upload-Datum.",
      "„Von Seite lesen“ holt Prüfer, Prüfdatum, dateModified und Standardversion von der Live-Seite. „Bearbeiten“ öffnet das Formular; dort „Freigabe dokumentieren“ mit Prüfer und Datum setzt die Seite auf freigegeben (v1.7). Ein Datum in der Zukunft wird abgelehnt.",
      "„Entitätsseite hinzufügen“ legt eine weitere Seite an. Eine eigene Entitätsseite lohnt nur, wenn Zielkunden gezielt nach der Entität fragen und genug belegbare Fakten vorliegen.",
      "Im SEO-Chat kennt der SEO-Berater diese Daten als „Grounding Pages (Tool-Kontext)“ und kann sie mit dem Werkzeug update_grounding_page zurückschreiben.",
      "Zeigt der Tab einen Ladefehler, fehlt meist die Migration für dt_grounding_pages in Supabase.",
    ],
  },
  {
    id: "seo-background",
    title: "Was im SEO-Modus im Hintergrund passiert",
    audience: "admin",
    lines: [
      "Crawl: „Jetzt crawlen“ in den SEO-Einstellungen startet den Job seo.crawl. Fortschritt und Fehler stehen unter Jobs. Ein leerer Crawl-Index heißt nicht, dass Google die Seite nicht kennt.",
      "SEO-Reports und Search-Console-Daten laufen über n8n. Hängt ein Report, zuerst unter Jobs und in den Vercel-Function-Logs nachsehen.",
      "Der SEO-Chat hat Websuche (höchstens 10 Suchen pro Antwort) und Web-Abruf. Ist das Limit erreicht, sagt der Chat das und eine neue Nachricht setzt es zurück.",
      "Monatliche Statistik und Reports brauchen eine Website-URL und möglichst Sitemap und Search-Console-Zugang in den SEO-Einstellungen.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Wenn etwas nicht geht (für alle)",
    audience: "all",
    lines: [
      "KI antwortet nicht oder meldet einen Fehler: Nachricht noch einmal senden, Seite neu laden. Bleibt es, Sichtbarkeitsmeister informieren; die Fehlermeldung dazu nennen.",
      "Anmeldung: Der Login läuft über einen Magic Link per E-Mail. Der Link gilt nur einmal und nur im Browser, in dem er angefordert wurde. Keine Mail: Spam-Ordner prüfen, dann erneut anfordern.",
      "„Zu viele Anmeldeversuche“: einige Minuten warten, dann erneut. Das ist ein Schutz vor zu vielen Links in kurzer Zeit.",
      "Einladung nicht erhalten: Spam-Ordner prüfen. Nach dem Login liegt die Einladung im Posteingang (/dashboard/inbox).",
      "Menüpunkt fehlt oder Seite ist leer: fast immer die Rolle oder die fehlende Firma in der Adresse (?org=). Der Firmeninhaber oder Sichtbarkeitsmeister kann die Rolle ändern.",
      "Upload scheitert: Dateityp und Größe prüfen. Beim Onboarding-Link muss das Passwort stimmen, das Sichtbarkeitsmeister mitgeteilt hat.",
      "Startseite zeigt nur die Marketing-Seite, obwohl man eingeloggt ist: Die Person ist noch in keiner Firma Mitglied. Einladung annehmen oder Sichtbarkeitsmeister fragen.",
    ],
  },
  {
    id: "troubleshooting-admin",
    title: "Wenn etwas nicht geht (Plattform-Admins)",
    audience: "admin",
    lines: [
      "KI antwortet nicht: ANTHROPIC_API_KEY in Vercel prüfen, Function-Logs öffnen. Modelle stehen in ANTHROPIC_DT_SEO_MODEL und Verwandten.",
      "Mails gehen nicht raus: SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM; danach das Protokoll unter E-Mails.",
      "Magic Link kommt an, Login scheitert: Redirect-URL /auth/confirm in Supabase für genau diese Domain.",
      "Report oder Crawl hängt: Jobs-Seite, dann n8n. Ein Job im Status error zeigt die Meldung in der Liste.",
      "Seite meldet „Datenbank noch nicht vorbereitet“: Die genannte Migration aus database/migrations im Supabase SQL Editor ausführen, in Datumsreihenfolge.",
      "Rechte fehlen oder sind zu weit: RLS-Policies in der neuesten passenden Migration und die RPCs.",
      "Neue Firma anlegen: Plattform-Übersicht. Dort DigitalTwin und SEO einschalten, sonst sind Chat und SEO-Modus gesperrt.",
    ],
  },
  {
    id: "support",
    title: "Kontakt zu Sichtbarkeitsmeister",
    audience: "all",
    lines: [
      `Support per E-Mail: ${DT_ONBOARDING_SUPPORT_EMAIL}. Telefon: ${DT_ONBOARDING_SWITCHBOARD_PHONE}.`,
      "Beim Melden eines Fehlers helfen: Seite (Adresse), Firma, Uhrzeit, genaue Fehlermeldung, ein Screenshot.",
    ],
  },
];

export function buildHelpHandbookText(role: HelpRole): string {
  const parts: string[] = ["## DigitalTwin-Handbuch (Wissen des Hilfe-Assistenten)"];
  for (const section of HELP_SECTIONS) {
    if (!audienceAllowed(section.audience, role)) continue;
    parts.push("", `### ${section.title}`, ...section.lines.map((line) => `- ${line}`));
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Route map: where the user is right now
// ---------------------------------------------------------------------------

export const DT_SEO_TAB_LABELS: Record<string, string> = {
  chat: "Chat (SEO-Berater)",
  stats: "Statistik",
  tasks: "Aufgaben",
  reports: "Reports",
  analyse: "Analyse (Crawl)",
  struktur: "Struktur",
  grounding: "Grounding",
  settings: "Einstellungen",
};

type RouteEntry = {
  test: (pathname: string) => boolean;
  label: string;
  audience: HelpAudience;
};

const ROUTES: RouteEntry[] = [
  { test: (p) => p === "/" , label: "Startseite mit DigitalTwin-Chat", audience: "all" },
  { test: (p) => p === "/settings" || p.startsWith("/settings/"), label: "Persönliche Einstellungen", audience: "all" },
  { test: (p) => p === "/dashboard", label: "Dashboard", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/inbox"), label: "Posteingang (Einladungen)", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/onboarding"), label: "Onboarding", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/ansprechpartner"), label: "Ansprechpartner", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/organisations/"), label: "Organisation (Details)", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/organisations"), label: "Organisationen", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/members"), label: "Mitglieder", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/frageboegen/neu"), label: "Fragebögen erzeugen", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/frageboegen"), label: "Fragebögen", audience: "all" },
  { test: (p) => /^\/dashboard\/surveys\/[^/]+\/responses\/[^/]+\/create-agent/.test(p), label: "Avatar aus Fragebogen-Antwort erzeugen", audience: "manager" },
  { test: (p) => /^\/dashboard\/surveys\/[^/]+\/responses/.test(p), label: "Fragebogen-Antworten", audience: "all" },
  { test: (p) => /^\/dashboard\/surveys\/[^/]+\/edit/.test(p), label: "Fragebogen bearbeiten", audience: "all" },
  { test: (p) => p === "/dashboard/surveys/new", label: "Neuer Fragebogen", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/surveys"), label: "Alle Umfragen", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/digital-twin/agents"), label: "Agenten", audience: "manager" },
  { test: (p) => p.startsWith("/dashboard/digital-twin/seo"), label: "SEO Modus", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/digital-twin"), label: "DigitalTwin-Chat", audience: "all" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/globale-prompts"), label: "Globale Prompts", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/agents"), label: "Agenten", audience: "manager" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/agent-kontext"), label: "Agent-Kontext", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/seo/crawl"), label: "SEO Modus · Crawl-Viewer", audience: "admin" },
  { test: (p) => /^\/dashboard\/verwaltung\/seo\/reports\//.test(p), label: "SEO Modus · Report", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/seo-text"), label: "SEO", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/seo"), label: "SEO Modus", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/texte"), label: "Texte", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/geo"), label: "GEO", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/hormozi"), label: "Hormozi", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/watermark-entfernung"), label: "Watermark Entfernung", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/verwaltung/usage"), label: "Token-Nutzung", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/transkripte"), label: "Transkripte", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/erstgespraech"), label: "Erstgespräch", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/leads"), label: "Leads (Leadinfo)", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/integrations"), label: "Integrationen", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/admin/agent-requests"), label: "Admin · Agent-Anfragen", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/admin/organisations") || p.startsWith("/dashboard/admin/digital-twin"), label: "Admin · Plattform-Übersicht", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/admin/team"), label: "Admin · Plattform-Team", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/admin/jobs"), label: "Admin · Jobs", audience: "admin" },
  { test: (p) => p.startsWith("/dashboard/admin/mails"), label: "Admin · E-Mails", audience: "admin" },
];

export type DashboardLocation = {
  pathname: string;
  /** Query string without the leading "?" (may be empty). */
  search: string;
};

export type DashboardLocationInfo = {
  label: string;
  /** e.g. "Tab Grounding" */
  detail: string | null;
  organisationId: string | null;
  /** Human sentence for prompt and UI. */
  sentence: string;
};

function uuidOrNull(value: string | null): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export function describeDashboardLocation(location: DashboardLocation | null | undefined): DashboardLocationInfo {
  const pathname = (location?.pathname || "/dashboard").split("?")[0] ?? "/dashboard";
  const params = new URLSearchParams(location?.search ?? "");
  const organisationId = uuidOrNull(params.get("org"));
  const entry = ROUTES.find((r) => r.test(pathname));
  const label = entry?.label ?? `Seite ${pathname}`;

  let detail: string | null = null;
  if (/^\/dashboard\/(verwaltung|digital-twin)\/seo/.test(pathname)) {
    const tab = params.get("tab") ?? "chat";
    detail = `Tab ${DT_SEO_TAB_LABELS[tab] ?? tab}`;
  }

  const parts = [`Du bist gerade auf „${label}“`];
  if (detail) parts.push(detail);
  if (organisationId) parts.push("Firma ist ausgewählt");
  return {
    label,
    detail,
    organisationId,
    sentence: `${parts.join(", ")} (${pathname}${location?.search ? `?${location.search}` : ""}).`,
  };
}

export type HelpRecentError = { at: string; message: string };

export function formatHelpContextForPrompt(input: {
  role: HelpRole;
  location: DashboardLocation | null | undefined;
  recentErrors: HelpRecentError[];
}): string {
  const info = describeDashboardLocation(input.location);
  const lines = [
    "## Hilfe-Kontext (aktuelle Sitzung)",
    `- Rolle des Nutzers: ${helpRoleLabel(input.role)}.`,
    `- Aktuelle Seite: ${info.sentence}`,
  ];
  if (input.recentErrors.length > 0) {
    lines.push("- Letzte Fehlermeldungen in dieser Sitzung (neueste zuerst):");
    for (const err of input.recentErrors.slice(0, 5)) {
      lines.push(`  - ${err.at}: ${err.message.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  } else {
    lines.push("- Keine Fehlermeldungen in dieser Sitzung aufgezeichnet.");
  }
  return lines.join("\n");
}
