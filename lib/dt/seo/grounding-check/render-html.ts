/**
 * grounding.html from the fact model: static, light HTML (no JavaScript, a few lines of
 * CSS) and one JSON-LD graph built from the same facts, so both mirror each other.
 * The review notice is NOT in the draft (standard: no placeholder before a documented
 * review); review-stamp.ts adds it, reviewedBy and lastReviewed when a person approves.
 */

import {
  GROUNDING_STANDARD_URL,
  GROUNDING_STANDARD_VERSION_UNREVIEWED,
} from "@/lib/dt/prompts/grounding-page-standard";
import {
  FACT_KEY_DEFS,
  type EntityKind,
  type FactKey,
  type GroundingEntity,
  type GroundingFact,
  type GroundingFactModel,
  dayLabel,
  factLabel,
  isLocalBusinessType,
  isVisibleOnlyKey,
  monthLabel,
  organisationEntity,
  visibleEntities,
} from "@/lib/dt/seo/grounding-check/fact-model";
import { looseName, normalizeDateValue, normalizeNumber, normalizePhone, parseGermanAddress } from "@/lib/dt/seo/grounding-check/normalize";

/** Where review-stamp.ts puts the review notice. */
export const REVIEW_NOTICE_MARKER = "<!-- gp:review-notice -->";

export type RenderInput = {
  model: GroundingFactModel;
  /** datePublished (YYYY-MM-DD): the existing page's, or today for a new page. */
  createdDay: string;
  /** dateModified (YYYY-MM-DD). */
  modifiedDay: string;
  /** Titles of the crawled pages by URL, for the source links. */
  sourceTitles?: Record<string, string>;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON for a <script> block: no „</script>“ can end it early. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

export function organisationNodeId(model: GroundingFactModel): string {
  return `${originOf(model.websiteUrl)}/#organization`;
}

export function entityNodeId(model: GroundingFactModel, entity: GroundingEntity): string {
  return entity.kind === "organization" ? organisationNodeId(model) : `${model.pageUrl}#${entity.id}`;
}

export function pageTitleOf(model: GroundingFactModel): string {
  return model.prose?.pageTitle?.trim() || `${model.organisationName}: Fakten`;
}

export function metaDescriptionOf(model: GroundingFactModel): string {
  const fromProse = model.prose?.metaDescription?.trim();
  if (fromProse) return fromProse;
  const definition = organisationEntity(model).definition.trim();
  return definition.length > 155 ? `${definition.slice(0, 152).replace(/\s+\S*$/, "")} …` : definition;
}

/** Entities on LocalBusiness-only properties (opening hours, price range) become LocalBusiness. */
export function effectiveSchemaType(entity: GroundingEntity): string {
  if (entity.kind !== "organization" || isLocalBusinessType(entity.schemaType)) return entity.schemaType;
  const needsPlace = entity.facts.some((f) => f.included && (f.key === "openingHours" || f.key === "priceRange"));
  return needsPlace ? "LocalBusiness" : entity.schemaType;
}

const PLATFORMS: Array<[RegExp, string]> = [
  [/linkedin\./i, "LinkedIn"],
  [/xing\./i, "XING"],
  [/instagram\./i, "Instagram"],
  [/facebook\./i, "Facebook"],
  [/youtube\.|youtu\.be/i, "YouTube"],
  [/tiktok\./i, "TikTok"],
  [/(twitter|x)\.com/i, "X"],
  [/pinterest\./i, "Pinterest"],
  [/google\.[a-z.]+\/maps|g\.page|maps\.app\.goo\.gl/i, "Google Maps"],
  [/wikipedia\.org/i, "Wikipedia"],
  [/wikidata\.org/i, "Wikidata"],
];

export function platformName(url: string): string | null {
  return PLATFORMS.find(([re]) => re.test(url))?.[1] ?? null;
}

function absoluteUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, "")}`;
}

function isoDateOrNull(value: string): string | null {
  const iso = normalizeDateValue(value);
  return /^\d{4}(-\d{2}){0,2}$/.test(iso) ? iso : null;
}

// --- visible HTML ------------------------------------------------------------------------------

function factValueHtml(fact: GroundingFact): string {
  const def = FACT_KEY_DEFS[fact.key];
  let inner: string;
  switch (def.valueType) {
    case "url": {
      const href = absoluteUrl(fact.value);
      const display = fact.key === "sameAs" ? (platformName(href) ?? fact.value) : fact.value;
      inner = `<a href="${escapeHtml(href)}">${escapeHtml(display)}</a>`;
      break;
    }
    case "email":
      inner = `<a href="mailto:${escapeHtml(fact.value.trim())}">${escapeHtml(fact.value)}</a>`;
      break;
    case "phone":
      inner = `<a href="tel:+${normalizePhone(fact.value)}">${escapeHtml(fact.value)}</a>`;
      break;
    case "date": {
      const iso = isoDateOrNull(fact.value);
      inner = iso ? `<time datetime="${iso}">${escapeHtml(fact.value)}</time>` : escapeHtml(fact.value);
      break;
    }
    default:
      inner = escapeHtml(fact.value);
  }
  if (fact.volatile && fact.asOf) inner += ` <span class="stand">(Stand: ${escapeHtml(monthLabel(fact.asOf))})</span>`;
  return `<dd${isVisibleOnlyKey(fact.key) ? ' data-visible-only="true"' : ""}>${inner}</dd>`;
}

/** One <dt> per key, one <dd> per value, keys in registry order. */
function dataGridHtml(entity: GroundingEntity): string {
  const order = Object.keys(FACT_KEY_DEFS) as FactKey[];
  const keys = order.filter((k) => entity.facts.some((f) => f.key === k));
  if (keys.length === 0) return "";
  const rows = keys.map((key) => {
    const facts = entity.facts.filter((f) => f.key === key);
    return `      <dt>${escapeHtml(factLabel(key, entity.kind))}</dt>\n${facts.map((f) => `      ${factValueHtml(f)}`).join("\n")}`;
  });
  return `    <dl class="data-grid">\n${rows.join("\n")}\n    </dl>`;
}

const SLUG_LABELS: Record<string, string> = {
  "ueber-uns": "Über uns",
  "uber-uns": "Über uns",
  "about": "Über uns",
  "faq": "FAQ",
};

function sourceLabel(url: string, titles: Record<string, string>): string {
  const title = titles[url]?.split(/\s[|–-]\s/)[0]?.trim();
  if (title) return title;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    if (!path) return "Startseite";
    const slug = decodeURIComponent(path.split("/").pop() ?? path).toLowerCase();
    const label = SLUG_LABELS[slug] ?? slug.replace(/[-_]+/g, " ");
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return url;
  }
}

function entitySources(entity: GroundingEntity): string[] {
  return [...new Set([entity.definitionSourceUrl, ...entity.facts.map((f) => f.sourceUrl)].filter((u): u is string => Boolean(u)))];
}

function sourceLineHtml(urls: string[], titles: Record<string, string>): string {
  if (urls.length === 0) return "";
  const links = urls.map((u) => `<a href="${escapeHtml(u)}">${escapeHtml(sourceLabel(u, titles))}</a>`).join(", ");
  return `    <p class="source">${urls.length === 1 ? "Quelle" : "Quellen"}: ${links}</p>`;
}

const GROUP_ORDER: Array<{ kind: EntityKind; id: string; heading: (org: string) => string }> = [
  { kind: "person", id: "personen", heading: (org) => `Personen bei ${org}` },
  { kind: "service", id: "leistungen", heading: (org) => `Leistungen von ${org}` },
  { kind: "product", id: "produkte", heading: (org) => `Produkte von ${org}` },
  { kind: "location", id: "standorte", heading: (org) => `Standorte von ${org}` },
  { kind: "method", id: "methoden", heading: (org) => `Methoden und Verfahren von ${org}` },
  { kind: "other", id: "weitere-begriffe", heading: (org) => `Weitere Begriffe zu ${org}` },
];

function entitySectionHtml(model: GroundingFactModel, entity: GroundingEntity, titles: Record<string, string>): string {
  const parts = [
    `  <section id="${escapeHtml(entity.id)}" data-entity="${escapeHtml(entityNodeId(model, entity))}">`,
    `    <h3>${escapeHtml(entity.name)}</h3>`,
    entity.definition ? `    <p class="definition">${escapeHtml(entity.definition)}</p>` : "",
    dataGridHtml(entity),
    entity.disambiguation.length > 0
      ? `    <p class="abgrenzung"><strong>Abgrenzung:</strong> ${escapeHtml(entity.disambiguation.join(" "))}</p>`
      : "",
    sourceLineHtml(entitySources(entity), titles),
    "  </section>",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Sources of everything on the page, for „Weiterführende Informationen“. */
export function pageSources(model: GroundingFactModel): string[] {
  const urls = new Set<string>();
  for (const entity of visibleEntities(model)) for (const u of entitySources(entity)) urls.add(u);
  for (const f of model.faq) if (f.included) urls.add(f.sourceUrl);
  return [...urls];
}

const CSS = `body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;color:#1b1f24;background:#fff}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 3rem}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0 0 1.5rem;padding:0;font-size:.875rem}
.breadcrumb li+li::before{content:"›";margin-right:.5rem;color:#6b7280}
.lead-definition{font-size:1.125rem}
.data-grid{display:grid;grid-template-columns:minmax(8rem,max-content) 1fr;gap:.35rem 1.25rem;margin:1rem 0}
.data-grid dt{font-weight:600}.data-grid dd{margin:0;grid-column:2}
.source,.page-meta{font-size:.875rem;color:#4b5563}
section{margin-top:2rem}`;

export function renderGroundingHtml(input: RenderInput): string {
  const { model } = input;
  const titles = input.sourceTitles ?? {};
  const org = organisationEntity(model);
  const entities = visibleEntities(model);
  const orgVisible = entities.find((e) => e.id === org.id) ?? { ...org, facts: [] };
  const origin = originOf(model.websiteUrl);
  const title = pageTitleOf(model);
  const description = metaDescriptionOf(model);
  const orgName = org.name;
  const faq = model.faq.filter((f) => f.included);

  const groups = GROUP_ORDER.map((group) => ({
    ...group,
    items: entities.filter((e) => e.kind === group.kind),
  })).filter((g) => g.items.length > 0);

  const body: string[] = [];
  body.push(`<nav aria-label="Brotkrumen"><ol class="breadcrumb"><li><a href="${escapeHtml(origin)}/">Startseite</a></li><li aria-current="page">${escapeHtml(title)}</li></ol></nav>`);
  body.push("<article>");
  body.push(`<h1>${escapeHtml(orgName)}</h1>`);
  const orgNode = escapeHtml(organisationNodeId(model));
  if (org.definition) body.push(`<p class="lead-definition" data-entity-ref="${orgNode}">${escapeHtml(org.definition)}</p>`);
  for (const paragraph of model.prose?.lead ?? []) body.push(`<p class="lead">${escapeHtml(paragraph)}</p>`);

  body.push(`<section id="kerndaten" data-entity="${orgNode}">`);
  body.push(`  <h2>${escapeHtml(orgName)}: Kerndaten</h2>`);
  const grid = dataGridHtml(orgVisible);
  if (grid) body.push(grid.replace(/^ {2}/gm, ""));
  const orgSources = sourceLineHtml(entitySources(orgVisible), titles);
  if (orgSources) body.push(orgSources.replace(/^ {2}/gm, ""));
  body.push("</section>");

  for (const group of groups) {
    if (group.kind === "organization") continue;
    body.push(`<section id="${group.id}">`);
    body.push(`  <h2>${escapeHtml(group.heading(orgName))}</h2>`);
    for (const entity of group.items) body.push(entitySectionHtml(model, entity, titles));
    body.push("</section>");
  }

  if (org.disambiguation.length > 0) {
    body.push(`<section id="abgrenzung" data-entity-ref="${orgNode}">`);
    body.push(`  <h2>Abgrenzung von ${escapeHtml(orgName)}</h2>`);
    body.push(`  <p class="abgrenzung">${escapeHtml(org.disambiguation.join(" "))}</p>`);
    body.push("</section>");
  }

  if (faq.length > 0) {
    body.push(`<section id="faq">`);
    body.push(`  <h2>Häufige Fragen zu ${escapeHtml(orgName)}</h2>`);
    for (const item of faq) {
      body.push(`  <h3>${escapeHtml(item.question)}</h3>`);
      body.push(`  <p>${escapeHtml(item.answer)}</p>`);
    }
    body.push("</section>");
  }

  const sources = pageSources(model);
  if (sources.length > 0) {
    body.push(`<section id="weiterfuehrende-informationen">`);
    body.push(`  <h2>Weiterführende Informationen zu ${escapeHtml(orgName)}</h2>`);
    body.push("  <ul>");
    for (const url of sources) body.push(`    <li><a href="${escapeHtml(url)}">${escapeHtml(sourceLabel(url, titles))}</a></li>`);
    body.push("  </ul>");
    body.push("</section>");
  }
  body.push("</article>");

  body.push(`<footer class="page-meta">`);
  body.push(
    `  <p>Erstellt: <time datetime="${input.createdDay}">${dayLabel(input.createdDay)}</time> · Zuletzt aktualisiert: <time datetime="${input.modifiedDay}">${dayLabel(input.modifiedDay)}</time></p>`,
  );
  body.push(`  ${REVIEW_NOTICE_MARKER}`);
  body.push(`  <p class="standard-notice">Grounding Page Standard v${GROUNDING_STANDARD_VERSION_UNREVIEWED}</p>`);
  body.push("</footer>");

  const graph = buildGroundingJsonLd(input);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${escapeHtml(model.pageUrl)}">
<!-- Grounding Page Standard v${GROUNDING_STANDARD_VERSION_UNREVIEWED} – ${GROUNDING_STANDARD_URL.replace(/^https:\/\//, "")} -->
<style>
${CSS}
</style>
</head>
<body>
<main>
${body.join("\n")}
</main>
<script type="application/ld+json">
${scriptJson(graph)}
</script>
</body>
</html>
`;
}

// --- JSON-LD -----------------------------------------------------------------------------------

class NodeBuilder {
  private readonly props = new Map<string, JsonValue[]>();

  add(prop: string, value: JsonValue) {
    this.props.set(prop, [...(this.props.get(prop) ?? []), value]);
  }

  build(base: JsonObject): JsonObject {
    const node: JsonObject = { ...base };
    for (const [prop, values] of this.props) node[prop] = values.length === 1 ? values[0]! : values;
    return node;
  }
}

function personRef(name: string, persons: Map<string, string>, jobTitle?: string): JsonObject {
  const ref: JsonObject = { "@type": "Person", name };
  const id = persons.get(looseName(name));
  if (id) ref["@id"] = id;
  if (jobTitle) ref.jobTitle = jobTitle;
  return ref;
}

function addressValue(value: string): JsonValue {
  const parsed = parseGermanAddress(value);
  if (!parsed) return value;
  return { "@type": "PostalAddress", ...parsed, addressCountry: "DE" };
}

function entityNode(
  model: GroundingFactModel,
  entity: GroundingEntity,
  ctx: { orgRef: JsonObject; persons: Map<string, string>; offers: GroundingEntity[] },
): JsonObject {
  const b = new NodeBuilder();
  const catalog: JsonObject[] = [];
  for (const fact of entity.facts) {
    const v = fact.value;
    switch (fact.key) {
      case "legalName":
        b.add("legalName", v);
        break;
      case "alternateName":
        b.add("alternateName", v);
        break;
      case "registerEntry":
        b.add("identifier", { "@type": "PropertyValue", propertyID: factLabel("registerEntry", entity.kind), value: v });
        break;
      case "vatId":
        b.add("vatID", v);
        break;
      case "foundingDate":
        b.add("foundingDate", isoDateOrNull(v) ?? v);
        break;
      case "founder":
        b.add("founder", personRef(v, ctx.persons));
        break;
      case "managingDirector":
      case "owner":
        b.add("employee", personRef(v, ctx.persons, factLabel(fact.key, entity.kind)));
        break;
      case "address":
        b.add("address", addressValue(v));
        break;
      case "phone":
        b.add("telephone", v);
        break;
      case "fax":
        b.add("faxNumber", v);
        break;
      case "email":
        b.add("email", v.trim());
        break;
      case "website":
        b.add("url", absoluteUrl(v));
        break;
      case "openingHours":
        b.add("openingHours", v);
        break;
      case "areaServed":
        b.add("areaServed", v);
        break;
      case "employeeCount": {
        const n = normalizeNumber(v);
        const quantity: JsonObject = { "@type": "QuantitativeValue" };
        if (/^\d+$/.test(n)) quantity.value = Number(n);
        if (v.trim() !== n) quantity.description = v;
        b.add("numberOfEmployees", quantity);
        break;
      }
      case "industry":
        b.add("keywords", v);
        break;
      case "certification":
        b.add("hasCertification", { "@type": "Certification", name: v });
        break;
      case "award":
        b.add("award", v);
        break;
      case "membership":
        b.add("memberOf", { "@type": "Organization", name: v });
        break;
      case "sameAs":
        b.add("sameAs", absoluteUrl(v));
        break;
      case "priceRange":
        b.add("priceRange", v);
        break;
      case "feature":
        b.add("amenityFeature", { "@type": "LocationFeatureSpecification", name: v, value: true });
        break;
      case "jobTitle":
        b.add("jobTitle", v);
        break;
      case "expertise":
        b.add("knowsAbout", v);
        break;
      case "qualification":
        b.add("hasCredential", { "@type": "EducationalOccupationalCredential", name: v });
        break;
      case "serviceType":
        b.add(entity.kind === "product" ? "category" : "serviceType", v);
        break;
      case "scope":
        if (entity.kind === "product") b.add("additionalProperty", { "@type": "PropertyValue", name: factLabel("scope", entity.kind), value: v });
        else catalog.push({ "@type": "Offer", itemOffered: { "@type": "Service", name: v } });
        break;
      case "audience":
        b.add("audience", { "@type": "Audience", audienceType: v });
        break;
      case "price":
        b.add("offers", { "@type": "Offer", description: v });
        break;
      case "rating":
        // Visible only: no review markup for the organisation's own ratings.
        break;
    }
  }
  if (catalog.length > 0) {
    b.add("hasOfferCatalog", { "@type": "OfferCatalog", name: factLabel("scope", entity.kind), itemListElement: catalog });
  }

  const base: JsonObject = { "@type": effectiveSchemaType(entity), "@id": entityNodeId(model, entity), name: entity.name };
  if (entity.definition) base.description = entity.definition;
  if (entity.disambiguation.length > 0) base.disambiguatingDescription = entity.disambiguation.join(" ");

  switch (entity.kind) {
    case "organization": {
      if (!entity.facts.some((f) => f.key === "website")) base.url = `${originOf(model.websiteUrl)}/`;
      if (ctx.offers.length > 0) {
        const services = ctx.offers.some((o) => o.kind === "service");
        b.add("hasOfferCatalog", {
          "@type": "OfferCatalog",
          name: services ? `Leistungen von ${entity.name}` : `Produkte von ${entity.name}`,
          itemListElement: ctx.offers.map((o) => ({
            "@type": "Offer",
            itemOffered: { "@type": o.kind === "product" ? "Product" : "Service", "@id": entityNodeId(model, o), name: o.name },
          })),
        });
      }
      break;
    }
    case "location":
      base.parentOrganization = ctx.orgRef;
      break;
    case "person":
      base.worksFor = ctx.orgRef;
      break;
    case "service":
      base.provider = ctx.orgRef;
      break;
    case "product":
      base.brand = ctx.orgRef;
      break;
    default:
      break;
  }
  return b.build(base);
}

/** The JSON-LD graph for the page (without the review fields; see review-stamp.ts). */
export function buildGroundingJsonLd(input: RenderInput): JsonObject {
  const { model } = input;
  const origin = originOf(model.websiteUrl);
  const org = organisationEntity(model);
  const entities = visibleEntities(model);
  const orgId = organisationNodeId(model);
  const orgRef: JsonObject = { "@id": orgId, name: org.name };
  const persons = new Map(entities.filter((e) => e.kind === "person").map((p) => [looseName(p.name), entityNodeId(model, p)]));
  const offers = entities.filter((e) => e.kind === "service" || e.kind === "product");
  const title = pageTitleOf(model);

  const graph: JsonObject[] = entities.map((entity) => entityNode(model, entity, { orgRef, persons, offers }));
  const webPage: JsonObject = {
    "@type": "WebPage",
    "@id": model.pageUrl,
    url: model.pageUrl,
    name: title,
    inLanguage: "de-DE",
    isPartOf: { "@type": "WebSite", "@id": `${origin}/#website`, url: `${origin}/` },
    about: { "@id": orgId },
    mainEntity: { "@id": orgId },
    breadcrumb: { "@id": `${model.pageUrl}#breadcrumb` },
    datePublished: input.createdDay,
    dateModified: input.modifiedDay,
  };
  const description = metaDescriptionOf(model);
  if (description) webPage.description = description;
  graph.push(webPage);
  graph.push({
    "@type": "BreadcrumbList",
    "@id": `${model.pageUrl}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Startseite", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: title, item: model.pageUrl },
    ],
  });
  const faq = model.faq.filter((f) => f.included);
  if (faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${model.pageUrl}#faq`,
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
