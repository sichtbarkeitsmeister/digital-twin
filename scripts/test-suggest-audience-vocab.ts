/**
 * Industry → questionnaire wording suggestions (heuristic + JSON parse).
 * Run: npx tsx scripts/test-suggest-audience-vocab.ts
 */
import assert from "node:assert/strict";

import {
  fallbackSuggestAudienceVocab,
  heuristicSuggestAudienceVocab,
  parseAudienceVocabSuggestion,
  parseAudienceVocabSuggestionPayload,
} from "../lib/surveys/suggest-audience-vocab";

const entrümpler = heuristicSuggestAudienceVocab({ industry: "Entrümpler" });
assert.ok(entrümpler);
assert.equal(entrümpler.source, "heuristic");
assert.equal(entrümpler.vocab.kind, "handwerk");
assert.equal(entrümpler.vocab.singular, "Kunde");
assert.equal(entrümpler.vocab.engagement, "Entrümpelung");
assert.equal(entrümpler.vocab.engagementGender, "f");
assert.equal(entrümpler.vocab.business, "Betrieb");

const ascii = heuristicSuggestAudienceVocab({ industry: "Entruempelung Berlin" });
assert.ok(ascii);
assert.equal(ascii.vocab.engagement, "Entrümpelung");

const umzug = heuristicSuggestAudienceVocab({
  organisationName: "Schnell Umzugsunternehmen GmbH",
});
assert.ok(umzug);
assert.equal(umzug.vocab.kind, "handwerk");
assert.equal(umzug.vocab.business, "Umzugsunternehmen");
assert.equal(umzug.vocab.engagement, "Umzug");
assert.equal(umzug.vocab.businessGender, "n");

const zahnarzt = heuristicSuggestAudienceVocab({ industry: "Zahnarztpraxis" });
assert.ok(zahnarzt);
assert.equal(zahnarzt.vocab.kind, "praxis");
assert.equal(zahnarzt.vocab.singular, "Patient");
assert.equal(zahnarzt.vocab.engagement, "Behandlung");
assert.equal(zahnarzt.vocab.business, "Zahnarztpraxis");

const steuer = heuristicSuggestAudienceVocab({ industry: "Steuerberater" });
assert.ok(steuer);
assert.equal(steuer.vocab.kind, "kanzlei");
assert.equal(steuer.vocab.singular, "Mandant");
assert.equal(steuer.vocab.engagement, "Mandat");

const fromServices = heuristicSuggestAudienceVocab({
  services: ["Haushaltsauflösung", "Keller räumen"],
});
assert.ok(fromServices);
assert.equal(fromServices.vocab.engagement, "Entrümpelung");

assert.equal(heuristicSuggestAudienceVocab({ industry: "xyz-unbekannt" }), null);

const fallback = fallbackSuggestAudienceVocab({ industry: "xyz-unbekannt" });
assert.equal(fallback.vocab.kind, "unternehmen");
assert.equal(fallback.vocab.singular, "Kunde");
assert.equal(fallback.vocab.business, "Firma");
assert.match(fallback.note, /Keine klare Branche/);

const parsed = parseAudienceVocabSuggestion({
  kind: "handwerk",
  label: "Dachdecker",
  business: "Betrieb",
  businessPlural: "Betriebe",
  businessGender: "m",
  singular: "Kunde",
  plural: "Kunden",
  engagement: "Auftrag",
  engagementPlural: "Aufträge",
  engagementGender: "m",
});
assert.ok(parsed);
assert.equal(parsed.kind, "handwerk");
assert.equal(parsed.label, "Dachdecker");
assert.equal(parsed.engagement, "Auftrag");
assert.equal(parsed.project, "Projekt");
assert.equal(parsed.booking, "Auftrag");

const missingGender = parseAudienceVocabSuggestion({
  kind: "handwerk",
  engagement: "Umzug",
  engagementPlural: "Umzüge",
});
assert.ok(missingGender);
assert.equal(missingGender.businessGender, "m");
assert.equal(missingGender.engagement, "Umzug");
assert.equal(missingGender.engagementGender, "m");

const payload = parseAudienceVocabSuggestionPayload({
  kind: "praxis",
  note: "Zahnmedizin.",
  business: "Zahnarztpraxis",
});
assert.ok(payload);
assert.equal(payload.note, "Zahnmedizin.");
assert.equal(payload.vocab.singular, "Patient");

assert.equal(parseAudienceVocabSuggestion(null), null);
assert.equal(parseAudienceVocabSuggestion("nope"), null);

console.log("test-suggest-audience-vocab: ok");
