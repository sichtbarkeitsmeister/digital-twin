/**
 * DigitalTwin-Hilfe: handbook role filter, dashboard location map, prompt variants.
 * Run: npx tsx scripts/test-help-assistant.ts
 */
import assert from "node:assert/strict";

import {
  buildCachedSurveyChatSystem,
  buildGlobalSurveyChatSystemPrompt,
  buildSurveyChatStaticSystemText,
  HELP_ROLE_ADMIN,
  HELP_ROLE_CUSTOMER,
} from "../lib/ai/chat-context";
import {
  audienceAllowed,
  buildHelpHandbookText,
  describeDashboardLocation,
  formatHelpContextForPrompt,
  HELP_SECTIONS,
  helpRoleLabel,
} from "../lib/help/handbook";

// --- audiences --------------------------------------------------------------
const member = { isPlatformAdmin: false, canManageDtAgents: false };
const manager = { isPlatformAdmin: false, canManageDtAgents: true };
assert.equal(audienceAllowed("all", member), true);
assert.equal(audienceAllowed("manager", member), false);
assert.equal(audienceAllowed("manager", manager), true);
assert.equal(audienceAllowed("admin", manager), false);
assert.equal(audienceAllowed("admin", HELP_ROLE_ADMIN), true);
assert.equal(helpRoleLabel(member), "Mitglied einer Firma");
assert.equal(helpRoleLabel(manager), "Firmeninhaber oder Firmen-Admin");

// --- handbook filtering -----------------------------------------------------
const memberBook = buildHelpHandbookText(member);
const adminBook = buildHelpHandbookText(HELP_ROLE_ADMIN);
assert.ok(memberBook.includes("### Menü und Wege"));
assert.ok(memberBook.includes("/dashboard/inbox"));
assert.ok(memberBook.includes("support@sichtbarkeitsmeister.de"));
assert.ok(!memberBook.includes("ANTHROPIC_API_KEY"), "customers never see env vars");
assert.ok(!memberBook.includes("/dashboard/verwaltung/seo"), "customers never see the SEO workspace");
assert.ok(!memberBook.includes("Agent-Kontext"));
assert.ok(adminBook.includes("### Grounding Pages"));
assert.ok(adminBook.includes("/dashboard/admin/mails"));
assert.ok(adminBook.length > memberBook.length);
const managerBook = buildHelpHandbookText(manager);
assert.ok(managerBook.includes("/dashboard/verwaltung/agents"));
assert.ok(!managerBook.includes("### Grounding Pages"));
assert.ok(HELP_SECTIONS.every((s) => s.lines.length > 0));

// --- location map -----------------------------------------------------------
const grounding = describeDashboardLocation({
  pathname: "/dashboard/verwaltung/seo",
  search: "org=0e2a3f1a-6f32-4e7d-9c71-5ab6f1c2d3e4&tab=grounding",
});
assert.equal(grounding.label, "SEO Modus");
assert.equal(grounding.detail, "Tab Grounding");
assert.equal(grounding.organisationId, "0e2a3f1a-6f32-4e7d-9c71-5ab6f1c2d3e4");
assert.ok(grounding.sentence.includes("SEO Modus"));

const seoDefault = describeDashboardLocation({ pathname: "/dashboard/verwaltung/seo", search: "" });
assert.equal(seoDefault.detail, "Tab Chat (SEO-Berater)");
assert.equal(seoDefault.organisationId, null);

assert.equal(describeDashboardLocation({ pathname: "/dashboard/inbox", search: "" }).label, "Posteingang (Einladungen)");
assert.equal(
  describeDashboardLocation({ pathname: "/dashboard/surveys/abc/responses/def/create-agent", search: "" }).label,
  "Avatar aus Fragebogen-Antwort erzeugen",
);
assert.equal(describeDashboardLocation({ pathname: "/dashboard/organisations/123", search: "" }).label, "Organisation (Details)");
assert.ok(describeDashboardLocation({ pathname: "/dashboard/unbekannt", search: "" }).label.includes("/dashboard/unbekannt"));
assert.equal(describeDashboardLocation(null).label, "Dashboard");

// --- help context block -----------------------------------------------------
const ctx = formatHelpContextForPrompt({
  role: member,
  location: { pathname: "/dashboard/onboarding", search: "org=0e2a3f1a-6f32-4e7d-9c71-5ab6f1c2d3e4" },
  recentErrors: [{ at: "2026-10-13T09:00:00.000Z", message: "Upload fehlgeschlagen: Datei zu groß" }],
});
assert.ok(ctx.includes("Rolle des Nutzers: Mitglied einer Firma"));
assert.ok(ctx.includes("Onboarding"));
assert.ok(ctx.includes("Upload fehlgeschlagen"));
assert.ok(formatHelpContextForPrompt({ role: member, location: null, recentErrors: [] }).includes("Keine Fehlermeldungen"));

// --- prompt variants --------------------------------------------------------
const customerStatic = buildSurveyChatStaticSystemText({ allowSurveyActions: false });
assert.ok(customerStatic.includes("DigitalTwin-Hilfe"));
assert.ok(customerStatic.includes("You cannot change any data"));
assert.ok(!customerStatic.includes("patch_survey_definition"));

const adminStatic = buildSurveyChatStaticSystemText({ allowSurveyActions: true });
assert.ok(adminStatic.includes("DigitalTwin-Hilfe"));
assert.ok(adminStatic.includes("patch_survey_definition"));
assert.equal(buildSurveyChatStaticSystemText(), adminStatic, "default keeps the admin behaviour for existing callers");

const baseInput = {
  pageContext: {
    page: "survey_list" as const,
    surveyId: null,
    location: { pathname: "/dashboard/verwaltung/seo", search: "tab=grounding" },
    recentErrors: [{ at: "2026-10-13T09:00:00.000Z", message: "Grounding-Page konnte nicht geladen werden." }],
  },
  surveys: [],
  folders: [],
  candidateSurveyContexts: [],
  attachmentSummaries: [],
  conversationSummary: "",
};

const customerPrompt = buildGlobalSurveyChatSystemPrompt({ ...baseInput, helpRole: HELP_ROLE_CUSTOMER });
assert.ok(customerPrompt.includes("## DigitalTwin-Handbuch"));
assert.ok(customerPrompt.includes("## Hilfe-Kontext"));
assert.ok(customerPrompt.includes("Grounding-Page konnte nicht geladen werden."));
assert.ok(!customerPrompt.includes("### Grounding Pages"), "customer prompt has no admin handbook sections");
assert.ok(!customerPrompt.includes("edit_dt_agent_prompt"));
assert.ok(!customerPrompt.includes("\"recentErrors\""), "errors are not duplicated into the JSON page context");

const defaultPrompt = buildGlobalSurveyChatSystemPrompt(baseInput);
assert.ok(!defaultPrompt.includes("### Grounding Pages"), "missing role falls back to least privilege");

const adminPrompt = buildGlobalSurveyChatSystemPrompt({ ...baseInput, helpRole: HELP_ROLE_ADMIN });
assert.ok(adminPrompt.includes("### Grounding Pages"));
assert.ok(adminPrompt.includes("edit_dt_agent_prompt"));

const cached = buildCachedSurveyChatSystem({ ...baseInput, helpRole: HELP_ROLE_ADMIN });
assert.ok(Array.isArray(cached));
const blocks = cached as Array<{ text: string }>;
assert.ok(blocks.length >= 3);
assert.ok(blocks[1]!.text.startsWith("## DigitalTwin-Handbuch"));
assert.ok(blocks[blocks.length - 1]!.text.includes("## Hilfe-Kontext"));

console.log("help-assistant tests: ok");
