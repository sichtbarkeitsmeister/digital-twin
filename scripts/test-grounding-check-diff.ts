/**
 * Grounding check: reading an existing page into the fact model, value normalisation and
 * the fact-model diff (deterministic + semantic verdicts).
 * Run: npx tsx scripts/test-grounding-check-diff.ts
 */
import assert from "node:assert/strict";

import {
  buildSemanticRequest,
  computeGroundingDiff,
  diffForNewPage,
  hasSubstantiveChanges,
  semanticRequestIsEmpty,
  type DiffItem,
} from "../lib/dt/seo/grounding-check/diff";
import {
  checkExistingPageStructure,
  entityFromHeading,
  labelToFactKey,
  parseExistingGroundingPage,
} from "../lib/dt/seo/grounding-check/existing-page";
import { normalizeLegalForm, quoteFoundIn } from "../lib/dt/seo/grounding-check/fact-model";
import {
  looseName,
  normalizeAddress,
  normalizeDateValue,
  normalizePhone,
  parseGermanAddress,
  splitStand,
} from "../lib/dt/seo/grounding-check/normalize";
import { EXISTING_LLMS_TXT, EXISTING_PAGE_HTML, LLMS_URL, PAGE_URL, SITE, websiteModel } from "./grounding-check-fixtures";

// --- normalisation ----------------------------------------------------------------------------
assert.equal(normalizePhone("02381 98765-0"), normalizePhone("+49 2381 98765-0"));
assert.equal(normalizePhone("+49 (0) 2381 987650"), "492381987650");
assert.equal(normalizePhone("0049 2381 987650"), "492381987650");
assert.equal(normalizeAddress("Musterstr. 12, 59065 Hamm"), normalizeAddress("Musterstraße 12, 59065 Hamm, Deutschland"));
assert.equal(normalizeAddress("Musterstrasse 12"), normalizeAddress("Musterstraße 12"));
assert.equal(normalizeDateValue("März 2012"), "2012-03");
assert.equal(normalizeDateValue("12.03.2012"), "2012-03-12");
assert.equal(normalizeDateValue("seit 2012"), "2012");
assert.equal(normalizeDateValue("2012-03-01T00:00:00Z"), "2012-03-01");
assert.deepEqual(splitStand("20 (Stand März 2026)"), { value: "20", asOf: "2026-03" });
assert.deepEqual(splitStand("10, Stand: Oktober 2026"), { value: "10", asOf: "2026-10" });
assert.deepEqual(splitStand("Hauptstandort Hamm"), { value: "Hauptstandort Hamm", asOf: null });
assert.deepEqual(parseGermanAddress("Von-Galen-Straße 40, 59065 Hamm, Deutschland"), {
  streetAddress: "Von-Galen-Straße 40",
  postalCode: "59065",
  addressLocality: "Hamm",
});
assert.equal(parseGermanAddress("Hamm"), null);
assert.equal(looseName("Beispiel Bau GmbH"), looseName("Beispiel-Bau"));
assert.equal(normalizeLegalForm("Gesellschaft mit beschränkter Haftung (GmbH)"), "GmbH");
assert.equal(normalizeLegalForm("GmbH & Co. KG"), "GmbH & Co. KG");
assert.equal(quoteFoundIn("Geschäftsführer: Anna  Muster", "Impressum … Geschäftsführer: Anna Muster · HRB 12345"), true);
assert.equal(quoteFoundIn("Gegründet 1999 von Max Muster", "Impressum … Geschäftsführer: Anna Muster"), false);

// --- headings and labels of existing pages ----------------------------------------------------
assert.deepEqual(entityFromHeading("Beispiel Bau GmbH: Kernfakten", "Beispiel Bau GmbH"), { name: "Beispiel Bau GmbH", kind: null });
assert.deepEqual(entityFromHeading("Beispiel Bau GmbH: Dachsanierung", "Beispiel Bau GmbH"), { name: "Dachsanierung", kind: null });
assert.deepEqual(entityFromHeading("André Petermann: Kernfakten", "Sichtbarkeitsmeister GmbH"), { name: "André Petermann", kind: null });
assert.deepEqual(entityFromHeading("Methode: SEO-Projektablauf", "X"), { name: "SEO-Projektablauf", kind: "method" });
assert.deepEqual(entityFromHeading("Kerndaten von Muster AG", "X"), { name: "Muster AG", kind: null });
assert.equal(labelToFactKey("Umsatzsteuer-ID"), "vatId");
assert.equal(labelToFactKey("Bürozeiten:"), "openingHours");
assert.equal(labelToFactKey("Geschäftsführer"), "managingDirector");
assert.equal(labelToFactKey("Lieblingsfarbe"), null);

// --- existing page → fact model ---------------------------------------------------------------
const existing = parseExistingGroundingPage({
  pageUrl: PAGE_URL,
  html: EXISTING_PAGE_HTML,
  llmsUrl: LLMS_URL,
  llmsTxt: EXISTING_LLMS_TXT,
  organisationName: "Beispiel Bau GmbH",
  websiteUrl: `${SITE}/`,
});
const org = existing.entities[0]!;
assert.equal(org.kind, "organization");
const values = (key: string) => org.facts.filter((f) => f.key === key).map((f) => f.value);
assert.deepEqual(values("phone"), ["+49 2381 98765-1"], "JSON-LD and <dl> phone are one fact");
assert.deepEqual(values("legalForm"), ["GmbH"]);
assert.deepEqual(values("registerEntry"), ["HRB 12345"]);
assert.deepEqual(values("employeeCount"), ["20"]);
assert.equal(org.facts.find((f) => f.key === "employeeCount")?.volatile, true);
assert.deepEqual(values("sameAs").sort(), ["https://www.facebook.com/beispielbau", "https://www.linkedin.com/company/beispiel-bau"]);
assert.deepEqual(values("openingHours"), ["Mo–Fr 7:00–17:00 Uhr"], "from llms.txt");
assert.equal(org.facts.find((f) => f.key === "openingHours")?.sourceUrl, LLMS_URL);
assert.match(org.definition, /Dachdeckerbetrieb aus Hamm/);
assert.deepEqual(org.disambiguation, ["Nicht zu verwechseln mit der Beispiel Bau AG in München."]);
const names = existing.entities.map((e) => `${e.kind}:${e.name}`);
assert.ok(names.includes("service:Dachsanierung"));
assert.ok(names.includes("service:Dachrinnenreinigung"));
assert.ok(names.includes("person:Anna Muster"));
assert.ok(!names.some((n) => n.includes("Wohnpark")), "headings without known facts create no entity");
assert.deepEqual(
  existing.entities.find((e) => e.name === "Dachsanierung")!.facts.filter((f) => f.key === "scope").map((f) => f.value),
  ["Steildach", "Flachdach", "Dachfenster"],
);
assert.equal(existing.faq.length, 1);
assert.equal(existing.faq[0]!.question, "In welchem Gebiet arbeitet die Beispiel Bau GmbH?");
assert.equal(existing.faq[0]!.answer, "Die Beispiel Bau GmbH arbeitet in Hamm und Umgebung.", "the standard line after the FAQ is not part of the answer");

// --- v1.7 structure of the old page -----------------------------------------------------------
const codes = checkExistingPageStructure(EXISTING_PAGE_HTML, { pageUrl: PAGE_URL, websiteUrl: `${SITE}/` }).map((i) => i.code);
for (const code of ["intro_box", "confidence_labels", "ai_wording", "missing_review", "missing_review_notice", "standard_version", "h1", "missing_abgrenzung", "missing_further_info", "mirror"]) {
  assert.ok(codes.includes(code), `structure issue ${code} expected, got ${codes.join(", ")}`);
}
assert.ok(!codes.includes("missing_faq"));
assert.ok(!codes.includes("org_id"));

// --- deterministic diff -----------------------------------------------------------------------
const next = websiteModel();
const find = (items: DiffItem[], pred: (i: DiffItem) => boolean) => items.find(pred);
const plain = computeGroundingDiff(next, existing);
const fact = (entity: string, key: string, value?: string) =>
  find(plain.items, (i) => i.entityName === entity && i.key === key && (value === undefined || i.newValue === value || i.oldValue === value));

assert.equal(fact("Beispiel Bau GmbH", "phone")?.kind, "changed");
assert.equal(fact("Beispiel Bau GmbH", "phone")?.oldValue, "+49 2381 98765-1");
assert.equal(fact("Beispiel Bau GmbH", "phone")?.sourceUrl, `${SITE}/kontakt/`, "changed items carry the website source");
assert.equal(fact("Beispiel Bau GmbH", "address")?.kind, "unchanged", "Str. = Straße");
assert.equal(fact("Beispiel Bau GmbH", "legalForm")?.kind, "unchanged");
assert.equal(fact("Beispiel Bau GmbH", "employeeCount")?.kind, "changed");
assert.equal(fact("Beispiel Bau GmbH", "openingHours")?.kind, "unchanged");
assert.equal(fact("Beispiel Bau GmbH", "website")?.kind, "added");
assert.equal(fact("Beispiel Bau GmbH", "sameAs", "https://www.facebook.com/beispielbau")?.kind, "removed");
assert.equal(fact("Beispiel Bau GmbH", "sameAs", "https://www.linkedin.com/company/beispiel-bau")?.kind, "unchanged");
assert.equal(fact("Dachsanierung", "scope", "Dachfenster")?.kind, "removed");
assert.equal(fact("Dachsanierung", "scope", "Flachdach")?.kind, "unchanged");
assert.equal(fact("Anna Muster", "qualification")?.kind, "added");
assert.equal(find(plain.items, (i) => i.scope === "entity" && i.entityName === "Fassadenbau")?.kind, "added");
assert.equal(find(plain.items, (i) => i.scope === "entity" && i.entityName === "Dachrinnenreinigung")?.kind, "removed");
assert.equal(find(plain.items, (i) => i.scope === "entity" && i.entityName === "Beispiel Bau GmbH Dortmund")?.kind, "added");
assert.equal(find(plain.items, (i) => i.scope === "definition" && i.entityName === "Beispiel Bau GmbH")?.kind, "changed", "without Claude, other wording counts as changed");
assert.equal(find(plain.items, (i) => i.scope === "faq" && i.label.startsWith("Saniert"))?.kind, "added");
assert.ok(hasSubstantiveChanges(plain));
assert.ok(!plain.items.some((i) => i.key === "rating"), "switched-off facts are not compared");
assert.equal(plain.counts.added + plain.counts.changed + plain.counts.removed + plain.counts.unchanged, plain.items.length);

// --- semantic request and verdicts ------------------------------------------------------------
const request = buildSemanticRequest(next, existing);
assert.ok(request.definitionPairs.some((p) => p.id === "organisation:definition"));
assert.ok(request.definitionPairs.some((p) => p.id === "organisation:disambiguation"));
assert.ok(request.entityCandidates.some((c) => c.side === "new" && c.name === "Fassadenbau"));
assert.ok(request.entityCandidates.some((c) => c.side === "old" && c.name === "Dachrinnenreinigung"));
assert.ok(!request.entityCandidates.some((c) => c.name === "Dachsanierung"), "obvious pairs are not asked");
assert.ok(request.faqCandidates.some((c) => c.side === "old"), "same question, different answer is asked");
assert.equal(semanticRequestIsEmpty(request), false);
assert.equal(semanticRequestIsEmpty(buildSemanticRequest(next, next)), true);

const oldFaqId = existing.faq[0]!.id;
const withVerdicts = computeGroundingDiff(next, existing, {
  entityMatches: [{ newId: "fassadenbau", oldId: existing.entities.find((e) => e.name === "Dachrinnenreinigung")!.id }],
  definitionVerdicts: [
    { id: "organisation:definition", same: true, note: "Gleiche Aussage." },
    { id: "organisation:disambiguation", same: true, note: "" },
  ],
  faqMatches: [{ newId: "faq-1", oldId: oldFaqId, sameAnswer: false, note: "Dortmund ist neu." }],
});
assert.equal(find(withVerdicts.items, (i) => i.scope === "definition" && i.entityName === "Beispiel Bau GmbH")?.kind, "unchanged");
const renamed = find(withVerdicts.items, (i) => i.scope === "entity" && i.entityName === "Fassadenbau");
assert.equal(renamed?.kind, "changed");
assert.equal(renamed?.oldValue, "Dachrinnenreinigung");
assert.equal(renamed?.via, "semantic");
assert.ok(!find(withVerdicts.items, (i) => i.scope === "entity" && i.entityName === "Dachrinnenreinigung"));
const faq = find(withVerdicts.items, (i) => i.scope === "faq" && i.label.startsWith("In welchem"));
assert.equal(faq?.kind, "changed");
assert.equal(faq?.note, "Dortmund ist neu.");

// --- nothing changed / no page ----------------------------------------------------------------
const same = computeGroundingDiff(next, next);
assert.equal(hasSubstantiveChanges(same), false);
assert.equal(same.counts.unchanged, same.items.length);
const fresh = diffForNewPage(next);
assert.equal(fresh.counts.removed + fresh.counts.changed + fresh.counts.unchanged, 0);
assert.ok(fresh.counts.added >= next.entities.length);

console.log("grounding-check diff tests: ok");
