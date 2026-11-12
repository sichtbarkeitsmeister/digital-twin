/**
 * Texte: client data. Kontaktdaten (one set per organisation, shared with the Firmenprofil):
 * manual values always win over the crawl and the web search, links come from the live HTML,
 * the prompt block carries only filled fields, every save lands in the Firmenprofil's change
 * log. Google-Profil: every link pattern, the web-search result accepted only when it matches,
 * no search with „Kein Google-Profil“. Kundenwünsche: in every writing step and the Texte
 * Watermark prompt, absent from the standalone tools, checked by Faktencheck and Endabnahme.
 * In-memory database, stubbed fetch and model; no network.
 * Run: npm run test:content-client-data
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type Anthropic from "@anthropic-ai/sdk";

import {
  EMPTY_ORG_CONTACT_DATA,
  applyAutomaticContactValues,
  applyManualContactValues,
  contactFieldBadge,
  contactFieldText,
  contactPromptData,
  diffContactData,
  readOrgContactData,
  resolveReusedField,
  type OrgContactData,
} from "../lib/dt/contact-data";
import {
  acceptExtractedContactValues,
  bestGoogleLink,
  contactValuesFromCrawl,
  extractContactLinks,
  extractContactTextFacts,
  pickContactPages,
  splitAddress,
} from "../lib/dt/contact-data-crawl";
import { fillContactDataFromWebsite, looksLikeBlockedPage, searchGoogleProfile } from "../lib/dt/contact-data-fill";
import { loadOrgContactData, saveOrgContactData } from "../lib/dt/contact-data-store";
import {
  GOOGLE_SEARCH_MAX_FETCHES,
  GOOGLE_SEARCH_MAX_SEARCHES,
  GOOGLE_SEARCH_TOOLS,
  acceptGoogleCandidate,
  googleLinksFromResearch,
  googleSearchPrompt,
  isGoogleProfileLink,
  parseGoogleSearchAnswer,
} from "../lib/dt/contact-google-search";
import { parseClientWishes } from "../lib/dt/content/client-wishes";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { parseContentPagePatch } from "../lib/dt/content/page-patch";
import { aktualitaetResearchPrompt, aktualitaetWriteSpec } from "../lib/dt/content/pipeline/aktualitaet";
import {
  BASE_RULES,
  CLIENT_WISHES_RULES,
  contentStepSpec,
  kontaktBlock,
  rephraseChunkPrompt,
  type ContentPipelineContext,
  type EndabnahmeOutput,
} from "../lib/dt/content/pipeline/prompts";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import type { ContentTextBlock } from "../lib/dt/content/render";
import {
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_VERMENSCHLICHUNG,
  contentStepDefinition,
} from "../lib/dt/content/pipeline/steps";
import { contentDbErrorMessage } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import { geoToolSpec } from "../lib/dt/text-tools/geo";
import { hormoziToolSpec } from "../lib/dt/text-tools/hormozi";
import { seoToolSpec } from "../lib/dt/text-tools/seo";
import { extractGoogleProfileUrls } from "../lib/surveys/org-crawl-prefill";
import { FakeDb, type FakeRow } from "./fake-supabase";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-11-03T10:00:00Z");

function data(fields: OrgContactData["fields"], extra: Partial<OrgContactData> = {}): OrgContactData {
  return { ...EMPTY_ORG_CONTACT_DATA, fields, custom: [], ...extra };
}

// --- Kontaktdaten: merge rules --------------------------------------------------------------------

function testManualValuesWin() {
  const current = data({
    telefon: { value: "0221 999", source: "manuell", updated_at: null },
    email: { value: "", source: "manuell", updated_at: null },
    ort: { value: "Köln", source: "crawl", updated_at: null },
    plz: { value: "50667", source: "antwort", updated_at: null },
  });
  const { data: next, changed } = applyAutomaticContactValues(
    current,
    { telefon: "0221 111", email: "info@x.de", ort: "Bonn", plz: "53111", strasse: "Hauptstraße 1" },
    "crawl",
    NOW,
  );
  assert.equal(next.fields.telefon?.value, "0221 999", "a manual value is never overwritten");
  assert.equal(next.fields.email?.value, "", "an emptied manual field stays empty");
  assert.equal(next.fields.plz?.value, "50667", "an answer counts as manual");
  assert.equal(next.fields.ort?.value, "Bonn", "a crawl value is refreshed by the next crawl");
  assert.equal(next.fields.strasse?.source, "crawl");
  assert.deepEqual(changed.sort(), ["ort", "strasse"]);

  const search = applyAutomaticContactValues(
    data({ google_profil: { value: "https://g.page/x", source: "crawl", updated_at: null } }),
    { google_profil: "https://maps.app.goo.gl/other" },
    "websuche",
  );
  assert.equal(search.data.fields.google_profil?.value, "https://g.page/x", "the web search never replaces a link from the website");
  const off = applyAutomaticContactValues(data({}, { no_google_profile: true }), { google_profil: "https://g.page/x" }, "crawl");
  assert.equal(off.data.fields.google_profil, undefined, "„Kein Google-Profil“: no link is filled");

  // A person saves the card: only changed fields become manual.
  const saved = applyManualContactValues(next, { fields: { ort: "Bonn", strasse: "Hauptstraße 2" } }, NOW);
  assert.equal(saved.fields.ort?.source, "crawl", "an unchanged crawl value keeps its source");
  assert.equal(saved.fields.strasse?.source, "manuell", "an edited field becomes manual");
  assert.equal(contactFieldBadge(saved, "ort", "Bonn"), "aus Crawl");
  assert.equal(contactFieldBadge(saved, "ort", "Bonn-Beuel"), null, "editing hides the label");
  const noGoogle = applyManualContactValues(data({ google_profil: { value: "https://g.page/x", source: "crawl", updated_at: null } }), { no_google_profile: true });
  assert.equal(noGoogle.fields.google_profil?.value, "", "„Kein Google-Profil“ empties the link");
  console.log("Kontaktdaten: manual values win: ok");
}

function testReusedFields() {
  assert.deepEqual(resolveReusedField({ value: "Muster", source: "crawl", updated_at: null }, "Muster")?.source, "crawl");
  assert.deepEqual(resolveReusedField({ value: "Muster", source: "crawl", updated_at: null }, "Muster GmbH")?.source, "manuell", "changed in the Firmenprofil");
  assert.equal(resolveReusedField({ value: "Max Muster", source: "crawl", updated_at: null }, "")?.value, "Max Muster", "empty column: the crawl value shows");
  assert.equal(resolveReusedField(null, "  "), null);
  console.log("Kontaktdaten: Firmenname, Website, Ansprechpartner from the Firmenprofil: ok");
}

function testPromptBlockOnlyFilled() {
  const prompt = contactPromptData(
    data({
      firmenname: { value: "Muster Dach GmbH", source: "manuell", updated_at: null },
      ansprechpartner: { value: "Max Muster", source: "manuell", updated_at: null },
      strasse: { value: "Hauptstraße 1", source: "crawl", updated_at: null },
      plz: { value: "50667", source: "crawl", updated_at: null },
      ort: { value: "Köln", source: "crawl", updated_at: null },
      telefon: { value: "0221 123456", source: "crawl", updated_at: null },
      fax: { value: "", source: "manuell", updated_at: null },
      google_profil: { value: "https://maps.app.goo.gl/abc", source: "websuche", updated_at: null },
    }, { custom: [{ label: "Notdienst", value: "0171 000", source: "manuell", updated_at: null }, { label: "Leer", value: "", source: "manuell", updated_at: null }] }),
    { ansprechpartnerRole: "Inhaber" },
  );
  assert.ok(prompt);
  const block = kontaktBlock({ contact: prompt });
  assert.match(block, /^## Kontaktdaten \(bestätigt\)/);
  assert.match(block, /- Firmenname: Muster Dach GmbH/);
  assert.match(block, /- Ansprechpartner: Max Muster \(Inhaber\)/);
  assert.match(block, /- Adresse: Hauptstraße 1, 50667 Köln/);
  assert.match(block, /- Telefon: 0221 123456/);
  assert.match(block, /- Notdienst: 0171 000/);
  assert.match(block, /Bewertungen auf Google ansehen/);
  assert.match(block, /nur nennen, wenn sie in den Anbieterfakten steht – nie erfinden/);
  for (const absent of ["Fax", "Mobil", "E-Mail", "Öffnungszeiten", "Facebook", "Leer", "Website"]) {
    assert.doesNotMatch(block, new RegExp(`- ${absent}:`), `${absent} is empty and not in the block`);
  }
  assert.equal(contactPromptData(data({})), null, "nothing filled: no block at all");
  // Seen in a real run: a company name copied with soft hyphens from the website.
  const shy = data({ firmenname: { value: "Rechts\u00adanwalts\u00adkanzlei DIEL", source: "manuell", updated_at: null } });
  assert.equal(contactFieldText(shy, "firmenname"), "Rechtsanwaltskanzlei DIEL");
  assert.equal(contactPromptData(shy)!.lines[0]!.value, "Rechtsanwaltskanzlei DIEL", "no soft hyphen in the prompt");
  assert.equal(kontaktBlock({ contact: null }), "");
  assert.match(kontaktBlock({ contact: contactPromptData(data({}, { no_google_profile: true })) }), /kein Google-Profil/);
  assert.match(BASE_RULES, /aus den Anbieterfakten, dem Faktenauszug, den Antworten des Kunden, den Kontaktdaten und den Anmerkungen der Redaktion/, "BASE_RULES accepts facts from the Kontaktdaten");
  console.log("Kontaktdaten: prompt block with filled fields only: ok");
}

// --- Kontaktdaten: the crawl ------------------------------------------------------------------------

const IMPRESSUM_HTML = `<!doctype html><html><head><title>Impressum – Muster Dach</title></head><body>
<nav><a href="/">Start</a><a href="/kontakt">Kontakt</a></nav>
<main><h1>Impressum</h1>
<p>Muster Dach GmbH<br>Hauptstraße 12<br>50667 Köln</p>
<p>Geschäftsführer: Max Mustermann</p>
<p>Telefon: <a href="tel:+4922112345678">0221 12345678</a><br>Fax: 0221 12345679<br>
E-Mail: <a href="mailto:info@muster-dach.de?subject=Anfrage">info@muster-dach.de</a></p>
<p>Datenschutz: <a href="mailto:datenschutz@muster-dach.de">datenschutz@muster-dach.de</a></p>
</main>
<footer>
<a href="https://www.facebook.com/musterdach/">Facebook</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Teilen</a>
<a href="https://instagram.com/muster.dach/?hl=de">Instagram</a>
<a href="https://www.linkedin.com/company/muster-dach">LinkedIn</a>
<a href="https://www.youtube.com/@musterdach">YouTube</a>
<a href="https://www.xing.com/pages/musterdach">XING</a>
</footer></body></html>`;

const KONTAKT_HTML = `<!doctype html><html><head><title>Kontakt</title></head><body><main>
<h1>Kontakt</h1><p>Öffnungszeiten: Mo–Fr 7:30–16:30 Uhr</p>
<p>Mobil: <a href="tel:0171%20234567">0171 234567</a></p>
<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12" width="600"></iframe>
<a href="https://search.google.com/local/writereview?placeid=ChIJabc123">Bewerten Sie uns</a>
</main></body></html>`;

const START_HTML = `<!doctype html><html><head><title>Muster Dach</title></head><body><main><h1>Dachdecker in Köln</h1>
<p>Wir decken Dächer in Köln und Umgebung: Steildach, Flachdach, Dachfenster und Reparaturen. Seit vielen Jahren für Privatkunden und Hausverwaltungen.</p>
<a href="https://maps.app.goo.gl/AbCdEf123">So finden Sie uns</a></main></body></html>`;

function testLinksFromLiveHtml() {
  const links = extractContactLinks(IMPRESSUM_HTML, "https://muster-dach.de/impressum");
  assert.deepEqual(links.phones, ["+4922112345678"]);
  assert.deepEqual(links.emails, ["info@muster-dach.de", "datenschutz@muster-dach.de"]);
  assert.deepEqual(links.facebook, ["https://www.facebook.com/musterdach"], "no share link");
  assert.deepEqual(links.instagram, ["https://instagram.com/muster.dach"]);
  assert.deepEqual(links.linkedin, ["https://www.linkedin.com/company/muster-dach"]);
  assert.deepEqual(links.youtube, ["https://www.youtube.com/@musterdach"]);
  assert.deepEqual(links.otherSocial, ["https://www.xing.com/pages/musterdach"]);
  const kontakt = extractContactLinks(KONTAKT_HTML, "https://muster-dach.de/kontakt");
  assert.deepEqual(kontakt.phones, ["0171 234567"], "URL-encoded tel: link");
  assert.ok(kontakt.google.includes("https://www.google.com/maps/embed?pb=!1m18!1m12"), "map iframe");
  assert.ok(kontakt.google.includes("https://search.google.com/local/writereview?placeid=ChIJabc123"), "review link");

  const values = contactValuesFromCrawl({
    texts: ["Muster Dach GmbH\nHauptstraße 12\n50667 Köln\nGeschäftsführer: Max Mustermann\nTelefon: 0221 12345678\nFax: 0221 12345679", "Öffnungszeiten: Mo–Fr 7:30–16:30 Uhr"],
    links: { ...links, phones: [...links.phones, ...kontakt.phones], google: [...kontakt.google, "https://maps.app.goo.gl/AbCdEf123"] },
  });
  assert.equal(values.telefon, "0221 12345678", "the tel: link's number, in the text's spelling");
  assert.equal(contactValuesFromCrawl({ texts: ["Telefon: 0221 999"], links: { ...links, phones: ["+4922112345678"] } }).telefon, "+4922112345678", "the link wins over another number in the text");
  assert.equal(values.mobil, "0171 234567");
  assert.equal(values.fax, "0221 12345679");
  assert.equal(values.email, "info@muster-dach.de", "no privacy mailbox");
  assert.deepEqual([values.strasse, values.plz, values.ort], ["Hauptstraße 12", "50667", "Köln"]);
  assert.equal(values.ansprechpartner, "Max Mustermann");
  assert.equal(values.firmenname, undefined, "the crawl never fills the Firmenname (real Impressum pages name the insurer too)");
  assert.match(values.oeffnungszeiten ?? "", /Mo–Fr 7:30–16:30 Uhr/);
  assert.equal(values.google_profil, "https://maps.app.goo.gl/AbCdEf123", "a profile link before the review link and the map embed");
  assert.equal(values.social_sonstige, "https://www.xing.com/pages/musterdach");

  assert.deepEqual(splitAddress("Am Ring 3a, D-10115 Berlin"), { strasse: "Am Ring 3a", plz: "10115", ort: "Berlin" });
  // Crawl text with the elements glued together, and the chamber's address before the practice's.
  const glued = extractContactTextFacts(
    "ImpressumZahnarztpraxis Ruth HennesMarktstrasse 186-188, 47798 KrefeldTelefon: 02151 9491118E-Mail: info@zahnarztpraxis-hennes.deimpressum",
  );
  assert.deepEqual([glued.strasse, glued.plz, glued.ort, glued.telefon, glued.email], ["Marktstrasse 186-188", "47798", "Krefeld", "02151 9491118", "info@zahnarztpraxis-hennes.de"]);
  const thirdParty = extractContactTextFacts(
    "Kammerzugehörigkeit Landeszahnärztekammer Nordrhein, Emanuel-Leutze-Straße 8, 40547 Düsseldorf. Praxis: Marktstraße 186, 47798 Krefeld",
  );
  assert.deepEqual([thirdParty.strasse, thirdParty.ort], ["Marktstraße 186", "Krefeld"], "the chamber's address is not the company's");
  assert.equal(extractContactTextFacts("Tel.: 0171 1234567").mobil, "0171 1234567", "a mobile number under „Tel.“ is Mobil");

  const picked = pickContactPages([
    { url: "https://muster-dach.de/leistungen/dach", title: "Dach", h1: null, text_content: null },
    { url: "https://muster-dach.de/kontakt/anfahrt", title: "Anfahrt", h1: null, text_content: null },
    { url: "https://muster-dach.de/kontakt", title: "Kontakt", h1: null, text_content: null },
    { url: "https://muster-dach.de/datenschutz", title: "Datenschutz und Kontakt", h1: null, text_content: null },
    { url: "https://muster-dach.de/impressum", title: "Impressum", h1: null, text_content: null },
    { url: "https://muster-dach.de/", title: "Start", h1: null, text_content: null },
  ]);
  assert.deepEqual(picked.map((p) => [p.kind, p.page.url]), [
    ["impressum", "https://muster-dach.de/impressum"],
    ["kontakt", "https://muster-dach.de/kontakt"],
    ["start", "https://muster-dach.de/"],
  ]);
  console.log("Kontaktdaten: links from the live HTML: ok");
}

function testExtractionAcceptsOnlyWhatIsOnThePage() {
  const page = "Muster Dach GmbH · Hauptstraße 12 · 50667 Köln · Tel. 0221/12345678 · Mo-Fr 8 bis 17 Uhr";
  const accepted = acceptExtractedContactValues(
    { strasse: "Hauptstraße 12", plz: "50667", ort: "Köln", telefon: "+49 221 12345678", email: "info@erfunden.de", oeffnungszeiten: "Mo–Fr 8–17 Uhr", mobil: "0171 999999", ansprechpartner: "", fax: "", },
    page,
  );
  assert.equal(accepted.telefon, "+49 221 12345678", "same digits");
  assert.equal(accepted.oeffnungszeiten, "Mo–Fr 8–17 Uhr", "every number is on the page");
  assert.equal(accepted.email, undefined, "an e-mail that is not on the page is dropped");
  assert.equal(accepted.mobil, undefined, "an invented number is dropped");
  console.log("Kontaktdaten: extraction only keeps what is on the page: ok");
}

function testBlockedPage() {
  assert.equal(looksLikeBlockedPage("Please wait while your request is being verified..."), true, "a bot check is no source");
  assert.equal(looksLikeBlockedPage(`Impressum\nAngerhof 13b, 40878 Ratingen\n${"Text ".repeat(60)}`), false);
  console.log("Kontaktdaten: a bot check falls back to the crawl text: ok");
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function testFillFromWebsite() {
  const db = new FakeDb({
    dt_site_pages: [
      { organisation_id: ORG, url: "https://muster-dach.de/", title: "Start", h1: "Dachdecker in Köln", text_content: "Dachdecker in Köln", is_excluded: false },
      { organisation_id: ORG, url: "https://muster-dach.de/impressum", title: "Impressum", h1: "Impressum", text_content: "Impressum (Crawl-Text)", is_excluded: false },
      { organisation_id: ORG, url: "https://muster-dach.de/kontakt", title: "Kontakt", h1: "Kontakt", text_content: "Kontakt", is_excluded: false },
    ],
    dt_org_config: [{ organisation_id: ORG, display_name: "Muster Dach", website_url: "https://muster-dach.de" }],
    dt_org_onboarding: [{ organisation_id: ORG, customer_contacts: [] }],
    dt_org_contact_data: [
      {
        organisation_id: ORG,
        fields: { telefon: { value: "0221 55555", source: "manuell", updated_at: "2026-10-01T00:00:00Z" } },
        custom_fields: [],
        no_google_profile: false,
      },
    ],
  });
  const fetched: string[] = [];
  const fetchImpl = async (url: string) => {
    fetched.push(url);
    if (url.endsWith("/impressum")) return htmlResponse(IMPRESSUM_HTML);
    if (url.endsWith("/kontakt")) return htmlResponse(KONTAKT_HTML);
    return htmlResponse(START_HTML);
  };
  let extractionCalls = 0;
  const result = await fillContactDataFromWebsite(db.service, ORG, {
    userId: USER,
    retryDelayMs: 0,
    fetchImpl,
    now: NOW,
    callTool: async () => {
      extractionCalls += 1;
      throw new Error("no model in the test");
    },
  });
  assert.ok(result.ok);
  assert.deepEqual([...new Set(fetched)].sort(), ["https://muster-dach.de/", "https://muster-dach.de/impressum", "https://muster-dach.de/kontakt"]);
  assert.equal(fetched.filter((u) => u.endsWith("/kontakt")).length, 2, "a page that reads like a bot check (too short) is fetched once more");
  assert.equal(extractionCalls, 0, "the heuristics filled the core fields: no model call");
  const loaded = await loadOrgContactData(db.service, ORG);
  assert.equal(loaded.data.fields.telefon?.value, "0221 55555", "the manual phone stays");
  assert.equal(loaded.data.fields.telefon?.source, "manuell");
  assert.equal(loaded.data.fields.email?.value, "info@muster-dach.de");
  assert.equal(loaded.data.fields.email?.source, "crawl");
  assert.equal(loaded.data.fields.google_profil?.value, "https://maps.app.goo.gl/AbCdEf123");
  assert.equal(loaded.data.fields.firmenname?.value, "Muster Dach", "the Anzeigename stays the Firmenname");
  assert.equal(loaded.data.fields.firmenname?.source, "manuell");
  assert.equal(loaded.data.fields.ansprechpartner?.value, "Max Mustermann", "no Ansprechpartner yet: the crawl's owner");
  assert.ok(!result.changed.includes("telefon"));
  assert.equal(db.rows("dt_org_onboarding")[0]!.customer_contacts instanceof Array && (db.rows("dt_org_onboarding")[0]!.customer_contacts as unknown[]).length, 0, "the crawl never writes the Firmenprofil's contacts");
  const log = db.rows("dt_company_profile_edits");
  assert.equal(log.length, 1, "the fill goes into the change log");
  assert.equal(log[0]!.edited_by_user_id, USER);
  assert.ok((log[0]!.changes as Array<{ key: string }>).some((c) => c.key === "kontakt.email"));
  assert.ok(!(log[0]!.changes as Array<{ key: string }>).some((c) => c.key === "kontakt.telefon"));

  // With the heuristics short of core fields, one extraction call on the cheap model.
  const sparse = new FakeDb({
    dt_site_pages: [{ organisation_id: ORG, url: "https://x.de/impressum", title: "Impressum", h1: null, text_content: "Inhaber Max Muster · Ringstraße 7 · 12345 Neustadt · Fon 030/1234567", is_excluded: false }],
  });
  const models: string[][] = [];
  const sparseResult = await fillContactDataFromWebsite(sparse.service, ORG, {
    userId: null,
    retryDelayMs: 0,
    fetchImpl: async () => new Response("", { status: 500 }),
    callTool: async (input) => {
      models.push(input.models);
      return { json: { telefon: "030 1234567", email: "erfunden@x.de" }, usage: { inputTokens: 1_000, outputTokens: 50 }, model: input.models[0]! };
    },
  });
  assert.ok(sparseResult.ok);
  assert.equal(models.length, 1, "exactly one extraction call");
  assert.match(models[0]![0]!, /haiku/, "on the cheap model");
  assert.ok(sparseResult.costEur > 0, "its cost is recorded");
  const sparseData = await loadOrgContactData(sparse.service, ORG);
  assert.equal(sparseData.data.fields.email, undefined, "nothing invented gets in");
  assert.equal(sparse.rows("dt_llm_usage_events")[0]?.mode, "content.contact", "usage recorded");
  assert.equal(sparse.rows("dt_company_profile_edits").length, 0, "no person known: no change log entry");
  console.log("Kontaktdaten: fill from the website: ok");
}

async function testChangeLog() {
  const db = new FakeDb({
    dt_org_config: [{ organisation_id: ORG, display_name: "Muster Dach", website_url: "https://muster-dach.de" }],
    dt_org_onboarding: [{ organisation_id: ORG, customer_contacts: [{ name: "Erika", role: "Büro", email: "erika@privat.de", phone: "0170 1" }] }],
  });
  const saved = await saveOrgContactData(db.service, {
    organisationId: ORG,
    userId: USER,
    values: { fields: { telefon: "0221 1", firmenname: "Muster Dach GmbH", ansprechpartner: "Erika Muster" }, custom: [{ label: "Notdienst", value: "0171 0" }] },
    note: "Kontaktdaten in Texte geändert",
    now: NOW,
  });
  const keys = saved.changes.map((c) => c.key).sort();
  assert.deepEqual(keys, ["kontakt.ansprechpartner", "kontakt.firmenname", "kontakt.telefon", "kontakt.weitere_felder"]);
  const log = db.rows("dt_company_profile_edits");
  assert.equal(log.length, 1);
  assert.equal(log[0]!.note, "Kontaktdaten in Texte geändert");
  assert.equal(db.rows("dt_org_config")[0]!.display_name, "Muster Dach GmbH", "the Firmenname is the Firmenprofil's Anzeigename");
  const contacts = db.rows("dt_org_onboarding")[0]!.customer_contacts as Array<{ name: string; email: string }>;
  assert.equal(contacts[0]!.name, "Erika Muster", "the Ansprechpartner is the first contact");
  assert.equal(contacts[0]!.email, "erika@privat.de", "the rest of the contact stays");
  const reloaded = await loadOrgContactData(db.service, ORG);
  assert.equal(reloaded.data.fields.firmenname?.source, "manuell");
  const prompt = contactPromptData(reloaded.data, { ansprechpartnerRole: reloaded.columns.firstContact?.role });
  assert.ok(prompt && !prompt.lines.some((l) => /privat|0170/.test(l.value)), "the contact's private e-mail and phone never reach the prompt");

  const again = await saveOrgContactData(db.service, { organisationId: ORG, userId: USER, values: { fields: { telefon: "0221 1" } } });
  assert.deepEqual(again.changes, [], "saving unchanged values is no change");
  assert.equal(db.rows("dt_company_profile_edits").length, 1, "and writes no log entry");

  const before = readOrgContactData({ fields: {}, no_google_profile: false });
  const after = readOrgContactData({ fields: {}, no_google_profile: true });
  assert.deepEqual(diffContactData(before, after).map((c) => c.key), ["kontakt.kein_google_profil"]);
  console.log("Kontaktdaten: change log: ok");
}

function testMigrationMessage() {
  const message = contentDbErrorMessage({ code: "42703", message: "column dt_content_pages.client_wishes does not exist" }, "x");
  assert.match(message, /20261103_dt_content_client_data\.sql/);
  const table = contentDbErrorMessage({ code: "PGRST205", message: "Could not find the table 'public.dt_org_contact_data' in the schema cache" }, "x");
  assert.match(table, /20261103_dt_content_client_data\.sql/);
  console.log("missing migration: clear message: ok");
}

// --- Google-Profil ------------------------------------------------------------------------------------

function testGoogleLinkPatterns() {
  const links = [
    "https://www.google.com/maps/place/Muster+Dach/@50.9,6.9,17z",
    "https://www.google.de/maps?cid=1234567890",
    "https://maps.google.com/?cid=1234567890",
    "https://maps.google.de/maps?q=Muster",
    "https://maps.app.goo.gl/AbCdEf123",
    "https://goo.gl/maps/xyz987",
    "https://g.page/muster-dach",
    "https://g.page/r/CbcdEFG/review",
    "https://share.google/AbC123",
    "https://search.google.com/local/writereview?placeid=ChIJabc123",
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3",
    "//www.google.com/maps/embed?pb=!1m18",
  ];
  for (const link of links) {
    const found = extractGoogleProfileUrls(`<a href="${link}">x</a>`);
    assert.equal(found.length, 1, `recognised: ${link}`);
    assert.ok(found[0]!.startsWith("https://"), `with https: ${link}`);
  }
  const embedded = extractContactLinks(`<iframe src="https://www.google.com/maps/embed?pb=!1m18&amp;x=1"></iframe>`, "https://x.de");
  assert.deepEqual(embedded.google, ["https://www.google.com/maps/embed?pb=!1m18&x=1"]);
  assert.deepEqual(extractGoogleProfileUrls("https://www.google.com/search?q=muster"), [], "a Google search is no profile");
  assert.equal(bestGoogleLink(["https://www.google.com/maps/embed?pb=1", "https://g.page/x"]), "https://g.page/x");
  assert.equal(isGoogleProfileLink("https://www.google.com/maps/search/?api=1&query=Muster"), false, "a map search is no profile");
  assert.equal(isGoogleProfileLink("https://maps.app.goo.gl/AbC"), true);
  console.log("Google: every link pattern: ok");
}

const KNOWN = data({
  firmenname: { value: "Muster Dach GmbH", source: "manuell", updated_at: null },
  strasse: { value: "Hauptstraße 12", source: "crawl", updated_at: null },
  plz: { value: "50667", source: "crawl", updated_at: null },
  ort: { value: "Köln", source: "crawl", updated_at: null },
  telefon: { value: "0221 12345678", source: "crawl", updated_at: null },
});

function testGoogleCandidateMatch() {
  const url = "https://www.google.com/maps/place/Muster+Dach/data=!4m2";
  const returned = [url, "https://www.dachdecker-koeln.de/"];
  const candidate = (extra: Partial<{ url: string; name: string; address: string; phone: string }>) => ({
    url,
    name: "Muster Dach GmbH",
    address: "Hauptstraße 12, 50667 Köln",
    phone: "",
    ...extra,
  });
  assert.deepEqual(acceptGoogleCandidate(candidate({}), KNOWN, returned), { ok: true, url });
  assert.ok(acceptGoogleCandidate(candidate({ address: "", phone: "+49 221 12345678" }), KNOWN, returned).ok, "name + phone");
  assert.equal(acceptGoogleCandidate(candidate({ name: "Dachdecker Schmitz" }), KNOWN, returned).ok, false, "another company");
  assert.equal(acceptGoogleCandidate(candidate({ address: "Ringstraße 1, 10115 Berlin", phone: "030 1" }), KNOWN, returned).ok, false, "name only is not enough");
  assert.equal(acceptGoogleCandidate(candidate({ url: "https://www.dachdecker-koeln.de/" }), KNOWN, returned).ok, false, "no Google link");
  assert.equal(acceptGoogleCandidate(candidate({ url: "https://maps.app.goo.gl/invented" }), KNOWN, returned).ok, false, "a link the search did not return");
  assert.equal(acceptGoogleCandidate(null, KNOWN, returned).ok, false);
  const fetchedLinks = googleLinksFromResearch(
    [{ type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://www.dach-verzeichnis.de/muster", content: { source: { data: "Muster Dach GmbH … Route: https://maps.app.goo.gl/FromDirectory" } } } }],
    ["https://www.dach-verzeichnis.de/muster"],
  );
  assert.deepEqual(fetchedLinks, ["https://maps.app.goo.gl/FromDirectory"], "a Google link inside a fetched page counts as returned");
  assert.deepEqual(parseGoogleSearchAnswer('Ich habe gesucht.\n{"url": "https://g.page/x", "name": "A", "address": "B", "phone": "C"}'), { url: "https://g.page/x", name: "A", address: "B", phone: "C" });
  assert.equal(parseGoogleSearchAnswer('{"url": ""}'), null);

  const prompt = googleSearchPrompt({ name: "Muster Dach GmbH", place: "Köln" });
  assert.equal(prompt.user, "Firma: Muster Dach GmbH\nOrt: Köln", "only the public name and place");
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`, /Hauptstraße|12345678|50667/, "no address or phone in the prompt");
  const search = GOOGLE_SEARCH_TOOLS.find((t) => (t as { name?: string }).name === "web_search") as { max_uses?: number };
  const fetchTool = GOOGLE_SEARCH_TOOLS.find((t) => (t as { name?: string }).name === "web_fetch") as { max_uses?: number };
  assert.equal(search.max_uses, GOOGLE_SEARCH_MAX_SEARCHES);
  assert.equal(fetchTool.max_uses, GOOGLE_SEARCH_MAX_FETCHES);
  assert.deepEqual([GOOGLE_SEARCH_MAX_SEARCHES, GOOGLE_SEARCH_MAX_FETCHES], [3, 2]);
  console.log("Google: a web-search result only when it matches: ok");
}

/** A stub Anthropic client (streamed like the API): one research turn with a search result and the JSON answer. */
function stubAnthropic(answer: string, resultUrls: string[], calls: { n: number }): Anthropic {
  const content = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Muster Dach GmbH Köln" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: resultUrls.map((url) => ({ type: "web_search_result", url, title: "Muster Dach GmbH" })) },
    { type: "text", text: answer },
  ];
  const create = async () => {
    calls.n += 1;
    async function* events() {
      yield { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      for (const [index, block] of content.entries()) yield { type: "content_block_start", index, content_block: block };
      yield {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { input_tokens: 4_000, output_tokens: 120, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
      };
    }
    return events();
  };
  return { messages: { create } } as unknown as Anthropic;
}

async function testGoogleSearchRuns() {
  const base = (extra: FakeRow = {}) =>
    new FakeDb({
      dt_org_config: [{ organisation_id: ORG, display_name: "Muster Dach GmbH", website_url: null }],
      dt_org_contact_data: [
        {
          organisation_id: ORG,
          fields: {
            plz: { value: "50667", source: "crawl", updated_at: null },
            ort: { value: "Köln", source: "crawl", updated_at: null },
            strasse: { value: "Hauptstraße 12", source: "crawl", updated_at: null },
          },
          custom_fields: [],
          no_google_profile: false,
          ...extra,
        },
      ],
    });
  const url = "https://www.google.com/maps/place/Muster+Dach/data=!4m2";
  const answer = `{"url": "${url}", "name": "Muster Dach GmbH", "address": "Hauptstraße 12, 50667 Köln", "phone": ""}`;

  {
    const db = base({ no_google_profile: true });
    const calls = { n: 0 };
    const outcome = await searchGoogleProfile(db.service, ORG, { userId: USER, force: true, anthropic: stubAnthropic(answer, [url], calls), models: ["claude-sonnet-5-5"] });
    assert.equal(outcome.ok, false);
    assert.equal(calls.n, 0, "„Kein Google-Profil“: nothing is searched, not even with the button");
  }
  {
    const db = base({ google_search: { at: "2026-11-01T00:00:00Z", status: "not_found", searches: 3 } });
    const calls = { n: 0 };
    const outcome = await searchGoogleProfile(db.service, ORG, { userId: USER, anthropic: stubAnthropic(answer, [url], calls), models: ["claude-sonnet-5-5"] });
    assert.equal(outcome.ok, false);
    assert.equal(calls.n, 0, "automatically only once per organisation");
  }
  {
    const db = base();
    const calls = { n: 0 };
    const outcome = await searchGoogleProfile(db.service, ORG, { userId: USER, anthropic: stubAnthropic(answer, [url], calls), models: ["claude-sonnet-5-5"], now: NOW });
    assert.ok(outcome.ok);
    assert.equal(calls.n, 1);
    assert.equal(outcome.search.status, "found");
    assert.ok(outcome.search.cost_eur > 0, "cost recorded");
    const loaded = await loadOrgContactData(db.service, ORG);
    assert.equal(loaded.data.fields.google_profil?.value, url);
    assert.equal(loaded.data.fields.google_profil?.source, "websuche", "„aus Websuche – bitte prüfen“");
    assert.equal(contactFieldBadge(loaded.data, "google_profil", url), "aus Websuche – bitte prüfen");
    assert.equal(db.rows("dt_llm_usage_events")[0]?.mode, "content.google_profil");
    assert.equal(db.rows("dt_llm_usage_events")[0]?.web_search_requests, 1);
  }
  {
    const db = base();
    const calls = { n: 0 };
    const outcome = await searchGoogleProfile(db.service, ORG, { userId: USER, anthropic: stubAnthropic(answer.replace("Muster Dach GmbH", "Schmitz Bedachungen"), [url], calls), models: ["claude-sonnet-5-5"] });
    assert.ok(outcome.ok);
    assert.equal(outcome.search.status, "rejected");
    const loaded = await loadOrgContactData(db.service, ORG);
    assert.equal(loaded.data.fields.google_profil, undefined, "a profile that does not match is not saved");
    assert.equal(loaded.data.google_search?.status, "rejected", "the search is recorded (no second automatic search)");
  }
  console.log("Google: the search, its limits and the „Kein Google-Profil“ stop: ok");
}

// --- Kundenwünsche -------------------------------------------------------------------------------------

const settings = { anrede: "Sie" as const, branche: "Steuerberatung", tonalitaet: "sachlich" as never, verbotene_woerter: [] };

function pipelineContext(extra: Partial<ContentPipelineContext> = {}): ContentPipelineContext {
  return {
    organisationName: "Kanzlei Müller",
    page: {
      name: "Steuerberatung",
      path: "/steuerberatung",
      level: 1,
      source: "structure",
      page_role: null,
      page_type: "unterseite",
      pillar_name: null,
      estimated_traffic: null,
      keywords: null,
      h1_options: [],
      user_questions: [],
      ki_prompt: null,
      internal_link_targets: [],
    },
    structureOutline: "",
    existingText: null,
    sections: [{ key: "leistungen", label: "Leistungen", current: "Steuererklärungen für Privatpersonen." }],
    settings,
    avatar: null,
    typePrompts: DEFAULT_CONTENT_TYPE_PROMPTS,
    notes: [],
    outputs: {},
    blocks: [
      { id: "h1", heading: "Steuerberatung in Köln", level: 1, html: "" },
      { id: "einleitung", heading: "Einleitung", level: 2, html: "<p>Unser Büro hilft Ihnen.</p>" },
    ],
    title: null,
    metaDescription: null,
    ...extra,
  };
}

const WISHES = {
  organisation: parseClientWishes("- Immer ‚Kanzlei‘ statt ‚Büro‘\n2. Inhaber: ‚Dr. Müller‘, nie mit Vornamen\n\nKeine Preise nennen\nKeine Preise nennen"),
  page: parseClientWishes("Notdienst nicht erwähnen"),
};

function testWishesInEveryWritingStep() {
  assert.deepEqual(WISHES.organisation, ["Immer ‚Kanzlei‘ statt ‚Büro‘", "Inhaber: ‚Dr. Müller‘, nie mit Vornamen", "Keine Preise nennen"], "one per line, bullets and repeats out");
  const context = pipelineContext({ wishes: WISHES, contact: contactPromptData(KNOWN) });
  const writing = [CONTENT_STEP_SEO, CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_LEKTORAT];
  for (const step of [...writing, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_ENDABNAHME]) {
    const spec = contentStepSpec(step, context);
    assert.match(spec.user, /## Hinweise zum Texten \(verbindlich\)\nFür alle Seiten:\n1\. Immer ‚Kanzlei‘ statt ‚Büro‘/, `step ${step}: wishes in the user message`);
    assert.match(spec.user, /Nur für diese Seite:\n4\. Notdienst nicht erwähnen/, `step ${step}: page wishes`);
  }
  for (const step of writing) {
    const spec = contentStepSpec(step, context);
    assert.ok(spec.system.includes(CLIENT_WISHES_RULES), `step ${step}: the priority rule is in the fixed system part`);
    assert.match(CLIENT_WISHES_RULES, /nie eine Frage an den Kunden/, "a wish conflict is an open point, not a question");
  }
  // The rule comes after the Texter-Prompt and the Textvorlage, before the Branchenregel.
  const seo = contentStepSpec(CONTENT_STEP_SEO, context).system;
  assert.ok(seo.indexOf("Seitentyp-Vorlage") < seo.indexOf(CLIENT_WISHES_RULES) && seo.indexOf(CLIENT_WISHES_RULES) < seo.indexOf("Branchenregel"));
  assert.match(CLIENT_WISHES_RULES, /gehen dem Text-Prompt, der Seitentyp-Vorlage und der Schrittanweisung vor/);
  assert.match(CLIENT_WISHES_RULES, /nie vor: den Regeln zu Tatsachen .*der Anrede, den verbotenen Wörtern und der Branchenregel/);
  assert.match(CLIENT_WISHES_RULES, /offenen Punkt, der den Hinweis wörtlich nennt/);

  // A saved step instruction (Globale Prompts) cannot remove it.
  const own = pipelineContext({ wishes: WISHES, stepPrompts: { hormozi: "Eigener Hormozi-Text ohne Wünsche." } });
  assert.ok(contentStepSpec(CONTENT_STEP_HORMOZI, own).system.includes(CLIENT_WISHES_RULES));

  // Aktualitätsprüfung: the result call writes text and gets them; the research call gets no wish text in its user message.
  const write = aktualitaetWriteSpec(context, { text: "Zeitkritische Aussagen: 0", sources: [], searches: 1, fetches: 0, search_limit_hit: false, claims: 0 });
  assert.match(write.user, /## Hinweise zum Texten \(verbindlich\)/);
  assert.ok(write.system.includes(CLIENT_WISHES_RULES));
  assert.doesNotMatch(aktualitaetResearchPrompt(context).user, /Kanzlei‘ statt|Dr\. Müller/, "no wish text near a search query");

  // Contact data reach SEO, Faktencheck, GEO, Hormozi and the Endabnahme, not the pure wording steps.
  for (const step of [CONTENT_STEP_SEO, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_ENDABNAHME]) {
    assert.match(contentStepSpec(step, context).user, /## Kontaktdaten \(bestätigt\)/, `step ${step}: Kontaktdaten`);
  }
  for (const step of [CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_LEKTORAT]) {
    assert.doesNotMatch(contentStepSpec(step, context).user, /## Kontaktdaten/, `step ${step}: no Kontaktdaten`);
  }

  // Without wishes the prompts stay as they were.
  const plain = pipelineContext();
  for (const step of [...writing, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_ENDABNAHME]) {
    const spec = contentStepSpec(step, plain);
    assert.doesNotMatch(`${spec.system}\n${spec.user}`, /## Hinweise zum Texten|Hinweise zum Texten \(feste Regel\)|## Kontaktdaten \(bestätigt\)/, `step ${step}: nothing without client data`);
  }
  console.log("Kundenwünsche: in every writing step: ok");
}

function testWishesInTexteWatermarkOnly() {
  const chunk: ContentTextBlock[] = [{ id: "einleitung", heading: "Einleitung", level: 2, html: "<p>Unser Büro hilft Ihnen.</p>" }];
  const texte = rephraseChunkPrompt(pipelineContext({ wishes: WISHES }), chunk);
  assert.match(texte.user, /## Hinweise zum Texten \(verbindlich\)/, "the Texte Watermark prompt carries the wishes");
  assert.match(texte.user, /gelten auch beim Neuformulieren/);
  const standalone = rephraseChunkPrompt({ notes: [] }, chunk);
  assert.doesNotMatch(`${standalone.system}\n${standalone.user}`, /Hinweise zum Texten/, "the standalone Watermark tool has none");
  assert.equal(texte.system, standalone.system, "the shared system prompt is unchanged");
  assert.match(readFileSync("lib/dt/text-tools/watermark.ts", "utf8"), /runRephraseOnBlocks\(\{ notes: \[\] \}/, "the tool passes no wishes");

  const sections = [{ key: "leistungen", label: "Leistungen", current: "Steuererklärungen." }];
  const blocks: ContentTextBlock[] = [{ id: "a", heading: "A", level: 1, html: "<p>Text.</p>" }];
  const seo = seoToolSpec({ organisationName: "X", pageName: "Y", pageType: "unterseite", material: null, sections, avatar: null, seoPrompt: null, typePrompts: DEFAULT_CONTENT_TYPE_PROMPTS });
  const geo = geoToolSpec({ organisationName: "X", fileName: "a.docx", pageName: "Y", sections, avatar: null, geoPrompt: null, blocks, title: null, metaDescription: null });
  const hormozi = hormoziToolSpec({ organisationName: "X", fileName: "a.docx", pageName: "Y", pageType: "unterseite", sections, avatar: { name: "Anna", role: "Kundin", beschreibung: "45." }, hormoziPrompt: null, blocks, title: null, metaDescription: null });
  for (const [name, spec] of [["SEO", seo], ["GEO", geo], ["Hormozi", hormozi]] as const) {
    assert.doesNotMatch(`${spec.system}\n${spec.user}`, /Hinweise zum Texten|Kontaktdaten \(bestätigt\)/, `standalone ${name}: no client data`);
  }
  console.log("Kundenwünsche: Texte Watermark yes, standalone tools no: ok");
}

function testChecksOfFaktencheckAndEndabnahme() {
  const context = pipelineContext({ wishes: WISHES, contact: contactPromptData(KNOWN) });
  const fakten = contentStepSpec(CONTENT_STEP_FAKTENCHECK, context).system;
  assert.match(fakten, /Prüfe jeden Hinweis einzeln\. Jeder Verstoß ist ein finding/);
  assert.match(fakten, /Prüfe den Text auch gegen die Kontaktdaten/);
  const endabnahme = contentStepSpec(CONTENT_STEP_ENDABNAHME, context).system;
  assert.match(endabnahme, /Prüfe jeden Hinweis zum Texten einzeln\. Jeder Verstoß .* kommt in unresolved/);
  assert.match(endabnahme, /Ein eingehaltener Hinweis ist kein offener Punkt/, "a kept wish is no open point (seen in a real run)");
  assert.match(endabnahme, /Prüfe Firmenname, Adresse und Telefon im Text gegen die Kontaktdaten/);

  // The Endabnahme's violations become the page's open points.
  const out: EndabnahmeOutput = {
    unresolved: [
      { title: "Hinweis zum Texten: Büro statt Kanzlei", problem: "Wunsch „Immer ‚Kanzlei‘ statt ‚Büro‘“: Abschnitt Einleitung sagt „Büro“.", proposal: "„Kanzlei“ schreiben.", severity: "high", severity_label: "Wichtig", block_id: "einleitung" },
    ],
    summary: "Fast fertig.",
  };
  const patch = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, out, { html: "<h1>Steuerberatung</h1>" });
  assert.deepEqual((patch.pagePatch.unresolved as Array<{ title: string }>).map((f) => f.title), ["Hinweis zum Texten: Büro statt Kanzlei"]);
  console.log("Kundenwünsche: Faktencheck and Endabnahme check each wish: ok");
}

function testPageWishesPatch() {
  const ok = parseContentPagePatch({ organisationId: ORG, client_wishes: "Notdienst nicht erwähnen" });
  assert.ok(ok.ok && ok.data.client_wishes === "Notdienst nicht erwähnen");
  const tooLong = parseContentPagePatch({ organisationId: ORG, client_wishes: "x".repeat(7_000) });
  assert.ok(!tooLong.ok && /höchstens/.test(tooLong.message));
  assert.equal(EMPTY_CONTENT_FRESHNESS.sendbacks, 0);
  const actions = readFileSync("lib/dt/content/pipeline/actions.ts", "utf8");
  assert.doesNotMatch(actions.slice(actions.indexOf("const RESET_PATCH"), actions.indexOf("} as const;", actions.indexOf("const RESET_PATCH"))), /client_wishes/, "„Zurücksetzen“ keeps the page's wishes");
  console.log("Kundenwünsche: per page: ok");
}

async function main() {
  testManualValuesWin();
  testReusedFields();
  testPromptBlockOnlyFilled();
  testLinksFromLiveHtml();
  testExtractionAcceptsOnlyWhatIsOnThePage();
  testBlockedPage();
  await testFillFromWebsite();
  await testChangeLog();
  testMigrationMessage();
  testGoogleLinkPatterns();
  testGoogleCandidateMatch();
  await testGoogleSearchRuns();
  testWishesInEveryWritingStep();
  testWishesInTexteWatermarkOnly();
  testChecksOfFaktencheckAndEndabnahme();
  testPageWishesPatch();
  console.log("OK: client data tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
