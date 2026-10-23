/**
 * Shared fixtures for the scripts/test-grounding-check-*.ts tests (not a test itself):
 * a website fact model, an existing v1.5-style grounding page and its llms.txt.
 */
import type { GroundingFact, GroundingFactModel } from "../lib/dt/seo/grounding-check/fact-model";

export const SITE = "https://www.beispiel-bau.de";
export const PAGE_URL = `${SITE}/grounding/`;
export const LLMS_URL = `${SITE}/llms.txt`;

function fact(id: string, key: GroundingFact["key"], value: string, path: string, extra: Partial<GroundingFact> = {}): GroundingFact {
  return {
    id,
    key,
    value,
    sourceUrl: `${SITE}${path}`,
    quote: value,
    volatile: false,
    asOf: null,
    included: true,
    ...extra,
  };
}

export function websiteModel(): GroundingFactModel {
  return {
    version: 1,
    organisationName: "Beispiel Bau GmbH",
    websiteUrl: `${SITE}/`,
    pageUrl: PAGE_URL,
    language: "de-DE",
    entities: [
      {
        id: "organisation",
        kind: "organization",
        ontologyClass: "Organization Entity Class",
        schemaType: "RoofingContractor",
        name: "Beispiel Bau GmbH",
        definition: "Die Beispiel Bau GmbH ist ein Dachdeckerbetrieb mit Sitz in Hamm, der Dächer und Fassaden in Westfalen saniert.",
        definitionSourceUrl: `${SITE}/ueber-uns/`,
        disambiguation: ["Die Beispiel Bau GmbH ist nicht identisch mit der Beispiel Bau AG in München."],
        facts: [
          fact("o1", "legalName", "Beispiel Bau GmbH", "/impressum/"),
          fact("o2", "legalForm", "GmbH", "/impressum/"),
          fact("o3", "registerEntry", "HRB 12345, Amtsgericht Hamm", "/impressum/"),
          fact("o4", "vatId", "DE123456789", "/impressum/"),
          fact("o5", "address", "Musterstraße 12, 59065 Hamm", "/impressum/"),
          fact("o6", "phone", "02381 98765-0", "/kontakt/"),
          fact("o7", "email", "info@beispiel-bau.de", "/kontakt/"),
          fact("o8", "website", "https://www.beispiel-bau.de/", "/impressum/"),
          fact("o9", "managingDirector", "Anna Muster", "/impressum/"),
          fact("o10", "foundingDate", "März 2012", "/ueber-uns/"),
          fact("o11", "employeeCount", "25", "/ueber-uns/", { volatile: true, asOf: "2026-10" }),
          fact("o12", "openingHours", "Mo–Fr 7:00–17:00 Uhr", "/kontakt/"),
          fact("o13", "sameAs", "https://www.linkedin.com/company/beispiel-bau", "/"),
          fact("o14", "rating", "4,9 von 5 Sternen", "/", { volatile: true, asOf: "2026-10", included: false }),
        ],
        included: true,
      },
      {
        id: "anna-muster",
        kind: "person",
        ontologyClass: "Person Entity Class",
        schemaType: "Person",
        name: "Anna Muster",
        definition: "Anna Muster ist Dachdeckermeisterin und Geschäftsführerin der Beispiel Bau GmbH.",
        definitionSourceUrl: `${SITE}/team/`,
        disambiguation: ["Anna Muster ist nicht die gleichnamige Architektin aus Köln."],
        facts: [fact("p1", "jobTitle", "Geschäftsführerin", "/team/"), fact("p2", "qualification", "Dachdeckermeisterin", "/team/")],
        included: true,
      },
      {
        id: "dachsanierung",
        kind: "service",
        ontologyClass: "Service Entity Class",
        schemaType: "Service",
        name: "Dachsanierung",
        definition: "Die Dachsanierung der Beispiel Bau GmbH umfasst die Erneuerung von Steil- und Flachdächern.",
        definitionSourceUrl: `${SITE}/leistungen/dachsanierung/`,
        disambiguation: ["Die Dachsanierung ist keine reine Dachreparatur nach Sturmschäden."],
        facts: [
          fact("s1", "scope", "Steildach", "/leistungen/dachsanierung/"),
          fact("s2", "scope", "Flachdach", "/leistungen/dachsanierung/"),
          fact("s3", "audience", "Privathaushalte und Hausverwaltungen", "/leistungen/dachsanierung/"),
          fact("s4", "areaServed", "Hamm und Umgebung", "/leistungen/dachsanierung/"),
        ],
        included: true,
      },
      {
        id: "fassadenbau",
        kind: "service",
        ontologyClass: "Service Entity Class",
        schemaType: "Service",
        name: "Fassadenbau",
        definition: "Der Fassadenbau der Beispiel Bau GmbH umfasst vorgehängte Fassaden aus Schiefer und Faserzement.",
        definitionSourceUrl: `${SITE}/leistungen/fassadenbau/`,
        disambiguation: ["Der Fassadenbau umfasst keine Malerarbeiten."],
        facts: [fact("f1", "scope", "Schieferfassaden", "/leistungen/fassadenbau/")],
        included: true,
      },
      {
        id: "standort-dortmund",
        kind: "location",
        ontologyClass: "Organization Entity Class",
        schemaType: "RoofingContractor",
        name: "Beispiel Bau GmbH Dortmund",
        definition: "Die Beispiel Bau GmbH Dortmund ist die Niederlassung der Beispiel Bau GmbH in Dortmund.",
        definitionSourceUrl: `${SITE}/standorte/dortmund/`,
        disambiguation: ["Die Niederlassung Dortmund ist kein eigenständiges Unternehmen."],
        facts: [
          fact("l1", "address", "Hafenweg 3, 44147 Dortmund", "/standorte/dortmund/"),
          fact("l2", "phone", "0231 55555", "/standorte/dortmund/"),
          fact("l3", "openingHours", "Mo–Do 8:00–16:00 Uhr", "/standorte/dortmund/"),
        ],
        included: true,
      },
    ],
    faq: [
      {
        id: "faq-1",
        question: "In welchem Gebiet arbeitet die Beispiel Bau GmbH?",
        answer: "Die Beispiel Bau GmbH arbeitet in Hamm, Dortmund und Umgebung.",
        sourceUrl: `${SITE}/leistungen/dachsanierung/`,
        quote: "Hamm und Umgebung",
        included: true,
      },
      {
        id: "faq-2",
        question: "Saniert die Beispiel Bau GmbH auch Flachdächer?",
        answer: "Ja, die Dachsanierung der Beispiel Bau GmbH umfasst Steil- und Flachdächer.",
        sourceUrl: `${SITE}/leistungen/dachsanierung/`,
        quote: "Flachdach",
        included: true,
      },
    ],
    openPoints: [
      { id: "op-1", reason: "internal_only", text: "Laut Fragebogen 30 Mitarbeitende; die Website nennt 25.", entityName: "Beispiel Bau GmbH", source: "Fragebogen" },
    ],
    prose: {
      pageTitle: "Beispiel Bau GmbH: Fakten",
      metaDescription: "Fakten zur Beispiel Bau GmbH: Dachdeckerbetrieb in Hamm mit Niederlassung in Dortmund, Dachsanierung und Fassadenbau.",
      lead: ["Die Beispiel Bau GmbH arbeitet seit 2012 in Hamm und hat eine Niederlassung in Dortmund."],
    },
  };
}

/** A v1.5 page like many live ones: intro box, „Konfidenz“, no review, partly stale facts. */
export const EXISTING_PAGE_HTML = `<!doctype html><html lang="de"><head><title>Grounding: Beispiel Bau</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":["RoofingContractor","Organization"],"@id":"https://www.beispiel-bau.de/#organization","name":"Beispiel Bau GmbH",
"legalName":"Beispiel Bau GmbH","telephone":"+49 2381 98765-1","email":"info@beispiel-bau.de",
"address":{"@type":"PostalAddress","streetAddress":"Musterstr. 12","postalCode":"59065","addressLocality":"Hamm","addressCountry":"DE"},
"vatID":"DE123456789","identifier":{"@type":"PropertyValue","name":"HRB","value":"12345"},
"description":"Beispiel Bau GmbH ist ein Dachdeckerbetrieb aus Hamm, der Dächer und Fassaden in Westfalen saniert.",
"numberOfEmployees":{"@type":"QuantitativeValue","value":20}},
{"@type":"WebPage","@id":"https://www.beispiel-bau.de/grounding/","dateModified":"2026-03-17"}]}</script>
</head><body><header><nav><a href="/">Start</a></nav></header><main>
<div class="notice"><p>Hinweis für menschliche Leser: Diese Seite enthält strukturierte faktische Definitionen der Beispiel Bau GmbH für KI-Systeme wie ChatGPT.</p></div>
<h1>Grounding Page: Beispiel Bau GmbH</h1>
<h2>Beispiel Bau GmbH: Kernfakten</h2>
<dl><dt>Offizieller Name</dt><dd>Beispiel Bau GmbH</dd>
<dt>Rechtsform</dt><dd>Gesellschaft mit beschränkter Haftung (GmbH)</dd>
<dt>Handelsregister</dt><dd>HRB 12345</dd>
<dt>Gründung</dt><dd>März 2012</dd>
<dt>Telefon</dt><dd>02381 98765-1</dd>
<dt>Mitarbeiterzahl</dt><dd>20 (Stand März 2026)</dd>
<dt>Geschäftsführer</dt><dd>Anna Muster</dd>
<dt>Soziale Profile</dt><dd><a href="https://www.linkedin.com/company/beispiel-bau">LinkedIn</a> · <a href="https://www.facebook.com/beispielbau">Facebook</a></dd></dl>
<p>Konfidenz: 1.0</p>
<h2>Beispiel Bau GmbH: Dachsanierung</h2>
<dl><dt>Leistungsumfang</dt><dd>Steildach · Flachdach · Dachfenster</dd><dt>Zielgruppe</dt><dd>Privathaushalte und Hausverwaltungen</dd></dl>
<h2>Beispiel Bau GmbH: Dachrinnenreinigung</h2>
<dl><dt>Leistungsumfang</dt><dd>Reinigung von Dachrinnen</dd></dl>
<h2>Referenz: Wohnpark Hamm</h2>
<dl><dt>Leistung</dt><dd>Dachsanierung 2023</dd></dl>
<h2>Häufige Fragen</h2>
<h3>In welchem Gebiet arbeitet die Beispiel Bau GmbH?</h3><p>Die Beispiel Bau GmbH arbeitet in Hamm und Umgebung.</p>
<p>Grounding Page Standard v1.5</p>
</main><footer><a href="/impressum/">Impressum</a></footer></body></html>`;

export const EXISTING_LLMS_TXT = `# Beispiel Bau GmbH – llms.txt
# Grounding Page Standard v1.5
# Stand: März 2026
# Canonical: https://www.beispiel-bau.de/grounding/
# Erstellt: 2026-03-17 | Aktualisiert: 2026-03-17 | Verifiziert: 2026-03-17

## ORGANISATION

entity: Beispiel Bau GmbH
class: Organization
name_official: Beispiel Bau GmbH
vat_id: DE123456789
founded: März 2012
email: info@beispiel-bau.de
hours: Mo–Fr 7:00–17:00 Uhr
social_linkedin: https://www.linkedin.com/company/beispiel-bau

disambiguation: Nicht zu verwechseln mit der Beispiel Bau AG in München.

---

## PERSON

entity: Anna Muster
class: Person
role: Geschäftsführerin

---

## METADATEN

grounding_page_url: https://www.beispiel-bau.de/grounding/
standard: Grounding Page Project Standard v1.5
updated: 2026-03-17
verified: 2026-03-17
`;
