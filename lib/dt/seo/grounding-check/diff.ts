/**
 * Deterministic comparison of the website's fact model with the existing grounding page.
 * Facts are compared per key with normalised values (phone digits, address words, ISO
 * dates …). What only meaning can decide — whether two descriptions say the same, whether
 * „SEO-Beratung“ and „Beratung zur Suchmaschinenoptimierung“ are one service, whether two
 * FAQ answers agree — is collected as a SemanticRequest and answered by Claude. Pure.
 */

import {
  FACT_KEY_DEFS,
  type EntityKind,
  type FactKey,
  type GroundingEntity,
  type GroundingFact,
  type GroundingFactModel,
  type GroundingFaq,
  factLabel,
  looseText,
  visibleEntities,
} from "@/lib/dt/seo/grounding-check/fact-model";
import type { StructuralIssue } from "@/lib/dt/seo/grounding-check/existing-page";
import { looseName, normalizeFactValue } from "@/lib/dt/seo/grounding-check/normalize";

export type DiffItemKind = "added" | "changed" | "removed" | "unchanged";

export type DiffItem = {
  id: string;
  kind: DiffItemKind;
  scope: "entity" | "fact" | "definition" | "disambiguation" | "faq";
  entityName: string;
  entityKind: EntityKind | null;
  key: FactKey | null;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  /** Website page that supports the new value (null for removals). */
  sourceUrl: string | null;
  quote: string | null;
  note: string | null;
  via: "deterministic" | "semantic";
};

export type GroundingDiff = {
  items: DiffItem[];
  structural: StructuralIssue[];
  counts: Record<DiffItemKind, number>;
};

/** Questions for the semantic comparison (Claude). Ids refer to the two fact models. */
export type SemanticRequest = {
  entityCandidates: Array<{ side: "new" | "old"; id: string; kind: EntityKind; name: string; definition: string }>;
  definitionPairs: Array<{ id: string; entityName: string; field: "definition" | "disambiguation"; oldText: string; newText: string }>;
  faqCandidates: Array<{ side: "new" | "old"; id: string; question: string; answer: string }>;
};

export type SemanticVerdicts = {
  entityMatches: Array<{ newId: string; oldId: string }>;
  definitionVerdicts: Array<{ id: string; same: boolean; note: string }>;
  faqMatches: Array<{ newId: string; oldId: string; sameAnswer: boolean; note: string }>;
};

export const EMPTY_SEMANTIC_VERDICTS: SemanticVerdicts = { entityMatches: [], definitionVerdicts: [], faqMatches: [] };

/** Keys with one value per entity; everything else is a set. */
const SINGLE_KEYS = new Set<FactKey>([
  "legalName",
  "legalForm",
  "registerEntry",
  "vatId",
  "foundingDate",
  "fax",
  "openingHours",
  "employeeCount",
  "rating",
  "priceRange",
  "jobTitle",
  "serviceType",
  "price",
]);

const KIND_LABEL: Record<EntityKind, string> = {
  organization: "Organisation",
  location: "Standort",
  person: "Person",
  service: "Leistung",
  product: "Produkt",
  method: "Methode",
  other: "Entität",
};

function compatibleKinds(a: EntityKind, b: EntityKind): boolean {
  if (a === b) return true;
  const fuzzy = new Set<EntityKind>(["service", "product", "method", "other"]);
  return fuzzy.has(a) && fuzzy.has(b);
}

/** Pairs entities whose identity is obvious: the organisation, then same kind + same name. */
export function matchEntitiesDeterministically(
  next: readonly GroundingEntity[],
  prev: readonly GroundingEntity[],
): Array<{ next: GroundingEntity; prev: GroundingEntity }> {
  const pairs: Array<{ next: GroundingEntity; prev: GroundingEntity }> = [];
  const usedPrev = new Set<string>();
  const nextOrg = next.find((e) => e.kind === "organization");
  const prevOrg = prev.find((e) => e.kind === "organization");
  if (nextOrg && prevOrg) {
    pairs.push({ next: nextOrg, prev: prevOrg });
    usedPrev.add(prevOrg.id);
  }
  for (const n of next) {
    if (n.kind === "organization") continue;
    const nName = looseName(n.name);
    const match = prev.find((p) => {
      if (usedPrev.has(p.id) || p.kind === "organization" || !compatibleKinds(n.kind, p.kind)) return false;
      const pName = looseName(p.name);
      if (!nName || !pName) return false;
      if (nName === pName) return true;
      // „Zahnarztpraxis Dr. Muster Hamm“ vs. „Standort Hamm“ is not obvious; containment is, from 6 letters on.
      const shorter = nName.length <= pName.length ? nName : pName;
      const longer = shorter === nName ? pName : nName;
      return shorter.length >= 6 && longer.includes(shorter) && n.kind === p.kind;
    });
    if (match) {
      pairs.push({ next: n, prev: match });
      usedPrev.add(match.id);
    }
  }
  return pairs;
}

function norm(fact: GroundingFact): string {
  return normalizeFactValue(FACT_KEY_DEFS[fact.key].valueType, fact.value);
}

function same(a: string, b: string): boolean {
  return looseText(a).replace(/[^\p{L}\p{N}]+/gu, " ").trim() === looseText(b).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Only what would be published: switched-off entities, facts and FAQ are not compared. */
function published(model: GroundingFactModel): GroundingFactModel {
  return { ...model, entities: visibleEntities(model), faq: model.faq.filter((f) => f.included) };
}

/** What Claude has to decide for this pair of models. */
export function buildSemanticRequest(nextModel: GroundingFactModel, prevModel: GroundingFactModel): SemanticRequest {
  const next = published(nextModel);
  const prev = published(prevModel);
  const pairs = matchEntitiesDeterministically(next.entities, prev.entities);
  const pairedNext = new Set(pairs.map((p) => p.next.id));
  const pairedPrev = new Set(pairs.map((p) => p.prev.id));

  const definitionPairs: SemanticRequest["definitionPairs"] = [];
  for (const { next: n, prev: p } of pairs) {
    if (n.definition && p.definition && !same(n.definition, p.definition)) {
      definitionPairs.push({ id: `${n.id}:definition`, entityName: n.name, field: "definition", oldText: p.definition, newText: n.definition });
    }
    const nd = n.disambiguation.join(" ");
    const pd = p.disambiguation.join(" ");
    if (nd && pd && !same(nd, pd)) {
      definitionPairs.push({ id: `${n.id}:disambiguation`, entityName: n.name, field: "disambiguation", oldText: pd, newText: nd });
    }
  }

  const faqPaired = matchFaqDeterministically(next.faq, prev.faq);
  const faqNew = new Set(faqPaired.map((p) => p.next.id));
  const faqOld = new Set(faqPaired.map((p) => p.prev.id));

  return {
    entityCandidates: [
      ...next.entities
        .filter((e) => !pairedNext.has(e.id))
        .map((e) => ({ side: "new" as const, id: e.id, kind: e.kind, name: e.name, definition: e.definition.slice(0, 400) })),
      ...prev.entities
        .filter((e) => !pairedPrev.has(e.id))
        .map((e) => ({ side: "old" as const, id: e.id, kind: e.kind, name: e.name, definition: e.definition.slice(0, 400) })),
    ],
    definitionPairs,
    faqCandidates: [
      ...next.faq.filter((f) => !faqNew.has(f.id)).map((f) => ({ side: "new" as const, id: f.id, question: f.question, answer: f.answer.slice(0, 600) })),
      ...prev.faq.filter((f) => !faqOld.has(f.id)).map((f) => ({ side: "old" as const, id: f.id, question: f.question, answer: f.answer.slice(0, 600) })),
      ...faqPaired
        .filter((p) => !same(p.next.answer, p.prev.answer))
        .flatMap((p) => [
          { side: "new" as const, id: p.next.id, question: p.next.question, answer: p.next.answer.slice(0, 600) },
          { side: "old" as const, id: p.prev.id, question: p.prev.question, answer: p.prev.answer.slice(0, 600) },
        ]),
    ],
  };
}

export function semanticRequestIsEmpty(request: SemanticRequest): boolean {
  const newEntities = request.entityCandidates.filter((c) => c.side === "new").length;
  const oldEntities = request.entityCandidates.filter((c) => c.side === "old").length;
  const newFaq = request.faqCandidates.filter((c) => c.side === "new").length;
  const oldFaq = request.faqCandidates.filter((c) => c.side === "old").length;
  return request.definitionPairs.length === 0 && (newEntities === 0 || oldEntities === 0) && (newFaq === 0 || oldFaq === 0);
}

function matchFaqDeterministically(next: readonly GroundingFaq[], prev: readonly GroundingFaq[]) {
  const out: Array<{ next: GroundingFaq; prev: GroundingFaq }> = [];
  const used = new Set<string>();
  for (const n of next) {
    const p = prev.find((x) => !used.has(x.id) && same(x.question, n.question));
    if (p) {
      used.add(p.id);
      out.push({ next: n, prev: p });
    }
  }
  return out;
}

function shortValue(value: string): string {
  return value.length > 400 ? `${value.slice(0, 397)}…` : value;
}

/** Fact-by-fact comparison of one entity pair. */
function diffFacts(n: GroundingEntity, p: GroundingEntity, push: (item: Omit<DiffItem, "id" | "via">) => void) {
  const keys = new Set<FactKey>([...n.facts.map((f) => f.key), ...p.facts.map((f) => f.key)]);
  for (const key of keys) {
    const label = factLabel(key, n.kind);
    const nf = n.facts.filter((f) => f.key === key);
    const pf = p.facts.filter((f) => f.key === key);
    const base = { scope: "fact" as const, entityName: n.name, entityKind: n.kind, key, label };

    if (SINGLE_KEYS.has(key) || (nf.length === 1 && pf.length === 1)) {
      const a = nf[0];
      const b = pf[0];
      if (a && b) {
        const equal = norm(a) === norm(b);
        push({
          ...base,
          kind: equal ? "unchanged" : "changed",
          oldValue: shortValue(b.value),
          newValue: shortValue(a.value),
          sourceUrl: a.sourceUrl,
          quote: a.quote,
          note: equal && a.volatile && a.asOf !== b.asOf ? "Wert gleich, neues Stand-Datum" : null,
        });
      } else if (a) {
        push({ ...base, kind: "added", oldValue: null, newValue: shortValue(a.value), sourceUrl: a.sourceUrl, quote: a.quote, note: null });
      } else if (b) {
        push({ ...base, kind: "removed", oldValue: shortValue(b.value), newValue: null, sourceUrl: null, quote: null, note: "Auf der Website nicht (mehr) belegt." });
      }
      continue;
    }

    const prevByNorm = new Map(pf.map((f) => [norm(f), f]));
    const nextNorms = new Set(nf.map(norm));
    for (const a of nf) {
      const b = prevByNorm.get(norm(a));
      push({
        ...base,
        kind: b ? "unchanged" : "added",
        oldValue: b ? shortValue(b.value) : null,
        newValue: shortValue(a.value),
        sourceUrl: a.sourceUrl,
        quote: a.quote,
        note: null,
      });
    }
    for (const b of pf) {
      if (nextNorms.has(norm(b))) continue;
      push({ ...base, kind: "removed", oldValue: shortValue(b.value), newValue: null, sourceUrl: null, quote: null, note: "Auf der Website nicht (mehr) belegt." });
    }
  }
}

/**
 * The full diff. `verdicts` are Claude's answers to buildSemanticRequest; without them,
 * differing descriptions count as changed and unmatched entities as added/removed.
 */
export function computeGroundingDiff(
  nextModel: GroundingFactModel,
  prevModel: GroundingFactModel,
  verdicts: SemanticVerdicts = EMPTY_SEMANTIC_VERDICTS,
  structural: StructuralIssue[] = [],
): GroundingDiff {
  const next = published(nextModel);
  const prev = published(prevModel);
  const items: DiffItem[] = [];
  let seq = 0;
  let via: DiffItem["via"] = "deterministic";
  const push = (item: Omit<DiffItem, "id" | "via">) => items.push({ ...item, id: `d${++seq}`, via });

  const pairs = matchEntitiesDeterministically(next.entities, prev.entities);
  const pairedNext = new Set(pairs.map((p) => p.next.id));
  const pairedPrev = new Set(pairs.map((p) => p.prev.id));
  const semanticPairs: typeof pairs = [];
  for (const m of verdicts.entityMatches) {
    const n = next.entities.find((e) => e.id === m.newId);
    const p = prev.entities.find((e) => e.id === m.oldId);
    if (!n || !p || pairedNext.has(n.id) || pairedPrev.has(p.id)) continue;
    pairedNext.add(n.id);
    pairedPrev.add(p.id);
    semanticPairs.push({ next: n, prev: p });
  }

  const definitionVerdict = new Map(verdicts.definitionVerdicts.map((v) => [v.id, v]));
  for (const pair of [...pairs, ...semanticPairs]) {
    via = semanticPairs.includes(pair) ? "semantic" : "deterministic";
    const { next: n, prev: p } = pair;
    if (via === "semantic" && !same(n.name, p.name)) {
      push({
        scope: "entity",
        kind: "changed",
        entityName: n.name,
        entityKind: n.kind,
        key: null,
        label: `${KIND_LABEL[n.kind]}: Name`,
        oldValue: p.name,
        newValue: n.name,
        sourceUrl: n.definitionSourceUrl,
        quote: null,
        note: "Gleiche Entität, anderer Name.",
      });
    }
    via = "deterministic";
    diffFacts(n, p, push);

    for (const field of ["definition", "disambiguation"] as const) {
      const newText = field === "definition" ? n.definition : n.disambiguation.join(" ");
      const oldText = field === "definition" ? p.definition : p.disambiguation.join(" ");
      const label = field === "definition" ? "Definition" : "Abgrenzung";
      const base = { scope: field, entityName: n.name, entityKind: n.kind, key: null, label };
      if (!newText && !oldText) continue;
      if (newText && !oldText) {
        push({ ...base, kind: "added", oldValue: null, newValue: shortValue(newText), sourceUrl: n.definitionSourceUrl, quote: null, note: null });
        continue;
      }
      if (!newText) {
        push({ ...base, kind: "removed", oldValue: shortValue(oldText), newValue: null, sourceUrl: null, quote: null, note: null });
        continue;
      }
      if (same(newText, oldText)) {
        push({ ...base, kind: "unchanged", oldValue: shortValue(oldText), newValue: shortValue(newText), sourceUrl: n.definitionSourceUrl, quote: null, note: null });
        continue;
      }
      const verdict = definitionVerdict.get(`${n.id}:${field}`);
      via = verdict ? "semantic" : "deterministic";
      push({
        ...base,
        kind: verdict?.same ? "unchanged" : "changed",
        oldValue: shortValue(oldText),
        newValue: shortValue(newText),
        sourceUrl: n.definitionSourceUrl,
        quote: null,
        note: verdict?.note || (verdict ? null : "Wortlaut weicht ab."),
      });
      via = "deterministic";
    }
  }

  for (const n of next.entities) {
    if (pairedNext.has(n.id)) continue;
    const firstSource = n.facts[0]?.sourceUrl ?? n.definitionSourceUrl;
    push({
      scope: "entity",
      kind: "added",
      entityName: n.name,
      entityKind: n.kind,
      key: null,
      label: KIND_LABEL[n.kind],
      oldValue: null,
      newValue: n.name,
      sourceUrl: firstSource,
      quote: n.facts[0]?.quote ?? null,
      note: n.facts.length > 0 ? `${n.facts.length} ${n.facts.length === 1 ? "Fakt" : "Fakten"}` : null,
    });
  }
  for (const p of prev.entities) {
    if (pairedPrev.has(p.id)) continue;
    push({
      scope: "entity",
      kind: "removed",
      entityName: p.name,
      entityKind: p.kind,
      key: null,
      label: KIND_LABEL[p.kind],
      oldValue: p.name,
      newValue: null,
      sourceUrl: null,
      quote: null,
      note: "Auf der Website nicht als zentrale Entität belegt.",
    });
  }

  // FAQ
  const faqPairs = matchFaqDeterministically(next.faq, prev.faq).map((p) => ({ ...p, semantic: null as SemanticVerdicts["faqMatches"][number] | null }));
  const faqNew = new Set(faqPairs.map((p) => p.next.id));
  const faqOld = new Set(faqPairs.map((p) => p.prev.id));
  for (const m of verdicts.faqMatches) {
    const existing = faqPairs.find((p) => p.next.id === m.newId && p.prev.id === m.oldId);
    if (existing) {
      existing.semantic = m;
      continue;
    }
    const n = next.faq.find((f) => f.id === m.newId);
    const p = prev.faq.find((f) => f.id === m.oldId);
    if (!n || !p || faqNew.has(n.id) || faqOld.has(p.id)) continue;
    faqNew.add(n.id);
    faqOld.add(p.id);
    faqPairs.push({ next: n, prev: p, semantic: m });
  }
  for (const { next: n, prev: p, semantic } of faqPairs) {
    const sameAnswer = semantic ? semantic.sameAnswer : same(n.answer, p.answer);
    via = semantic ? "semantic" : "deterministic";
    push({
      scope: "faq",
      kind: sameAnswer ? "unchanged" : "changed",
      entityName: next.organisationName,
      entityKind: null,
      key: null,
      label: n.question,
      oldValue: shortValue(p.answer),
      newValue: shortValue(n.answer),
      sourceUrl: n.sourceUrl,
      quote: n.quote,
      note: semantic?.note || null,
    });
    via = "deterministic";
  }
  for (const n of next.faq) {
    if (faqNew.has(n.id)) continue;
    push({ scope: "faq", kind: "added", entityName: next.organisationName, entityKind: null, key: null, label: n.question, oldValue: null, newValue: shortValue(n.answer), sourceUrl: n.sourceUrl, quote: n.quote, note: null });
  }
  for (const p of prev.faq) {
    if (faqOld.has(p.id)) continue;
    push({ scope: "faq", kind: "removed", entityName: next.organisationName, entityKind: null, key: null, label: p.question, oldValue: shortValue(p.answer), newValue: null, sourceUrl: null, quote: null, note: null });
  }

  const counts: Record<DiffItemKind, number> = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  for (const item of items) counts[item.kind] += 1;
  return { items, structural, counts };
}

/** Diff for a site without a grounding page: everything the website states is new. */
export function diffForNewPage(next: GroundingFactModel): GroundingDiff {
  const empty: GroundingFactModel = { ...next, entities: [], faq: [], openPoints: [] };
  return computeGroundingDiff(next, empty);
}

export function hasSubstantiveChanges(diff: GroundingDiff): boolean {
  return diff.counts.added + diff.counts.changed + diff.counts.removed > 0;
}
