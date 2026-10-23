/**
 * llms.txt in the agency's house style (sichtbarkeitsmeister.de/llms.txt): comment header,
 * „## SECTION“ headings, one „entity: / class: / key: value“ block per entity separated by
 * „---“, and a closing „## METADATEN“. Built from the same facts as grounding.html. Pure.
 */

import {
  GROUNDING_STANDARD_VERSION_UNREVIEWED,
  ontologyShortName,
} from "@/lib/dt/prompts/grounding-page-standard";
import {
  FACT_KEY_DEFS,
  type EntityKind,
  type FactKey,
  type GroundingEntity,
  type GroundingFact,
  type GroundingFactModel,
  monthLabel,
  visibleEntities,
} from "@/lib/dt/seo/grounding-check/fact-model";
import { platformName } from "@/lib/dt/seo/grounding-check/render-html";

const SECTIONS: Array<{ kind: EntityKind; heading: string }> = [
  { kind: "organization", heading: "ORGANISATION" },
  { kind: "person", heading: "PERSONEN" },
  { kind: "service", heading: "LEISTUNGEN" },
  { kind: "product", heading: "PRODUKTE" },
  { kind: "location", heading: "STANDORTE" },
  { kind: "method", heading: "METHODEN" },
  { kind: "other", heading: "WEITERE BEGRIFFE" },
];

/** One line per value; several values of one key become an indented list. */
function factLines(entity: GroundingEntity): string[] {
  const lines: string[] = [];
  const order = Object.keys(FACT_KEY_DEFS) as FactKey[];
  const valueText = (f: GroundingFact) => (f.volatile && f.asOf ? `${f.value} (Stand ${monthLabel(f.asOf)})` : f.value);
  for (const key of order) {
    const facts = entity.facts.filter((f) => f.key === key);
    if (facts.length === 0) continue;
    if (key === "sameAs") {
      for (const f of facts) {
        const platform = platformName(f.value);
        lines.push(`${platform ? `social_${platform.toLowerCase().replace(/[^a-z]+/g, "_")}` : "same_as"}: ${f.value}`);
      }
      continue;
    }
    const llmsKey = FACT_KEY_DEFS[key].llmsKey;
    if (facts.length === 1) lines.push(`${llmsKey}: ${valueText(facts[0]!)}`);
    else lines.push(`${llmsKey}:`, ...facts.map((f) => `  - ${valueText(f)}`));
  }
  return lines;
}

function entityBlock(entity: GroundingEntity): string {
  const lines = [
    `entity: ${entity.name}`,
    `class: ${ontologyShortName(entity.ontologyClass)}`,
    `schema_type: ${entity.schemaType}`,
  ];
  if (entity.definition) lines.push(`definition: ${entity.definition}`);
  lines.push(...factLines(entity));
  if (entity.disambiguation.length > 0) lines.push("", `disambiguation: ${entity.disambiguation.join(" ")}`);
  return lines.join("\n");
}

export type LlmsRenderInput = {
  model: GroundingFactModel;
  llmsUrl: string;
  createdDay: string;
  modifiedDay: string;
  /** YYYY-MM for the „Stand“ header line. */
  month: string;
};

export function renderGroundingLlmsTxt(input: LlmsRenderInput): string {
  const { model } = input;
  const entities = visibleEntities(model);
  const out: string[] = [
    `# ${model.organisationName} – llms.txt`,
    `# Grounding Page Standard v${GROUNDING_STANDARD_VERSION_UNREVIEWED}`,
    `# Stand: ${monthLabel(input.month)}`,
    `# Canonical: ${model.pageUrl}`,
    `# Erstellt: ${input.createdDay} | Aktualisiert: ${input.modifiedDay}`,
  ];

  for (const section of SECTIONS) {
    const items = entities.filter((e) => e.kind === section.kind);
    if (items.length === 0) continue;
    out.push("", `## ${section.heading}`, "");
    out.push(items.map(entityBlock).join("\n\n---\n\n"));
    out.push("", "---");
  }

  out.push(
    "",
    "## METADATEN",
    "",
    `grounding_page_url: ${model.pageUrl}`,
    `llms_txt_url: ${input.llmsUrl}`,
    `standard: Grounding Page Standard v${GROUNDING_STANDARD_VERSION_UNREVIEWED}`,
    "language: de-DE",
    `created: ${input.createdDay}`,
    `updated: ${input.modifiedDay}`,
    `entity_count: ${entities.length}`,
    `maintainer: ${model.organisationName}`,
  );
  return `${out.join("\n")}\n`;
}
