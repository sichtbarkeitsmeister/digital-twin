import type { SurveyPurpose } from "@/lib/surveys/purpose";
import type { SurveyField, SurveyStep } from "@/lib/surveys/types";

export type CoreQuestionPrefillHint =
  | "org_name"
  | "website"
  | "employee_count"
  | "owner_name"
  | "focus"
  | "region"
  | "usp"
  | "services"
  | "target_group"
  | "competitors"
  | "good_competitors"
  | "persona_name"
  | "persona_job"
  | "persona_age"
  | "persona_pain";

export type CoreQuestionTemplate = {
  key: string;
  stepId: string;
  stepTitle: string;
  title: string;
  description: string;
  required: boolean;
  type: "text";
  prefillHint?: CoreQuestionPrefillHint;
};

/** Fixed basis for Anbieter (SEO-/Firmenwissen) questionnaires. */
export const ANBIETER_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  {
    key: "company_name",
    stepId: "core_company",
    stepTitle: "Unternehmen",
    title: "Wie lautet der offizielle Firmenname?",
    description: "Rechtlicher Name inkl. Rechtsform, falls relevant.",
    required: true,
    type: "text",
    prefillHint: "org_name",
  },
  {
    key: "website",
    stepId: "core_company",
    stepTitle: "Unternehmen",
    title: "Wie lautet die Website?",
    description: "Haupt-URL der Organisation.",
    required: true,
    type: "text",
    prefillHint: "website",
  },
  {
    key: "owner_name",
    stepId: "core_company",
    stepTitle: "Unternehmen",
    title: "Wer ist Inhaber / Geschäftsführung / Hauptansprechpartner?",
    description: "Name(n) aus Kundengespräch oder Impressum — später nicht nochmal abfragen.",
    required: false,
    type: "text",
    prefillHint: "owner_name",
  },
  {
    key: "employee_count",
    stepId: "core_company",
    stepTitle: "Unternehmen",
    title: "Wie viele Personen arbeiten im Unternehmen?",
    description: "Ungefähre Mitarbeiterzahl / Teamgröße.",
    required: true,
    type: "text",
    prefillHint: "employee_count",
  },
  {
    key: "focus",
    stepId: "core_offer",
    stepTitle: "Angebot & Fokus",
    title: "Worauf liegt der inhaltliche Fokus des Unternehmens?",
    description: "Kernleistung, Spezialisierung, Positionierung.",
    required: true,
    type: "text",
    prefillHint: "focus",
  },
  {
    key: "services",
    stepId: "core_offer",
    stepTitle: "Angebot & Fokus",
    title: "Welche Leistungen oder Produkte stehen im Vordergrund?",
    description: "Die wichtigsten Angebote in klaren Stichpunkten.",
    required: true,
    type: "text",
    prefillHint: "services",
  },
  {
    key: "usp",
    stepId: "core_offer",
    stepTitle: "Angebot & Fokus",
    title: "Was unterscheidet das Unternehmen klar vom Wettbewerb?",
    description: "USP / Alleinstellung / Philosophie.",
    required: true,
    type: "text",
    prefillHint: "usp",
  },
  {
    key: "region",
    stepId: "core_market",
    stepTitle: "Markt & Zielgruppe",
    title: "In welcher Region oder welchem Markt ist das Unternehmen aktiv?",
    description: "Einzugsgebiet, Branchenmarkt, online/offline.",
    required: false,
    type: "text",
    prefillHint: "region",
  },
  {
    key: "target_group",
    stepId: "core_market",
    stepTitle: "Markt & Zielgruppe",
    title: "Wer ist die wichtigste Zielgruppe?",
    description: "B2B/B2C, Branchen, Rollen — aus Unternehmenssicht.",
    required: true,
    type: "text",
    prefillHint: "target_group",
  },
  {
    key: "competitors",
    stepId: "core_competition",
    stepTitle: "Wettbewerb",
    title: "Welche Mitbewerber sind relevant?",
    description:
      "Namen, Domains oder kurze Notizen aus dem Kundengespräch — möglichst direkt übernehmen.",
    required: false,
    type: "text",
    prefillHint: "competitors",
  },
  {
    key: "good_competitors",
    stepId: "core_competition",
    stepTitle: "Wettbewerb",
    title: "Welche guten Wettbewerber / Vorbilder gibt es?",
    description:
      "Starke Anbieter, an denen man sich orientiert — oft nur im Gespräch genannt.",
    required: false,
    type: "text",
    prefillHint: "good_competitors",
  },
];

/** Fixed basis for Kunden-Persona (Wunschkunde) questionnaires. */
export const PERSONA_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  {
    key: "persona_name",
    stepId: "core_persona",
    stepTitle: "Persona",
    title: "Wie heißt der digitale Kunden-Avatar?",
    description: "Vorname / Kurzname der Wunschkunden-Persona.",
    required: true,
    type: "text",
    prefillHint: "persona_name",
  },
  {
    key: "persona_job",
    stepId: "core_persona",
    stepTitle: "Persona",
    title: "Welche Berufs- oder Lebenssituation hat die Persona typischerweise?",
    description: "Rolle, Alltag, Rahmenbedingungen.",
    required: true,
    type: "text",
    prefillHint: "persona_job",
  },
  {
    key: "persona_age",
    stepId: "core_persona",
    stepTitle: "Persona",
    title: "Welches Alter bzw. welche Altersgruppe passt typischerweise?",
    description: "Altersangabe oder Spanne.",
    required: false,
    type: "text",
    prefillHint: "persona_age",
  },
  {
    key: "persona_pain",
    stepId: "core_needs",
    stepTitle: "Bedarf & Motivation",
    title: "Was beschäftigt die Persona gerade am meisten?",
    description: "Schmerzpunkt / Anlass für den Erstkontakt.",
    required: true,
    type: "text",
    prefillHint: "persona_pain",
  },
  {
    key: "persona_goal",
    stepId: "core_needs",
    stepTitle: "Bedarf & Motivation",
    title: "Was möchte die Persona erreichen?",
    description: "Zielbild / gewünschtes Ergebnis.",
    required: true,
    type: "text",
  },
  {
    key: "persona_criteria",
    stepId: "core_needs",
    stepTitle: "Bedarf & Motivation",
    title: "Wonach sucht sich die Persona einen Anbieter aus?",
    description: "Entscheidungskriterien, Must-haves.",
    required: true,
    type: "text",
  },
];

export function coreQuestionsForPurpose(purpose: SurveyPurpose): CoreQuestionTemplate[] {
  return purpose === "anbieter" ? ANBIETER_CORE_QUESTIONS : PERSONA_CORE_QUESTIONS;
}

export function fieldIdForCoreKey(key: string): string {
  return `core_${key}`;
}

export function buildCoreFields(templates: CoreQuestionTemplate[]): {
  steps: SurveyStep[];
  fieldIdsByKey: Record<string, string>;
} {
  const fieldIdsByKey: Record<string, string> = {};
  const byStep = new Map<string, { title: string; fields: SurveyField[] }>();

  for (const t of templates) {
    const fieldId = fieldIdForCoreKey(t.key);
    fieldIdsByKey[t.key] = fieldId;
    const field: SurveyField = {
      id: fieldId,
      type: "text",
      title: t.title,
      description: t.description,
      required: t.required,
    };
    const existing = byStep.get(t.stepId);
    if (existing) {
      existing.fields.push(field);
    } else {
      byStep.set(t.stepId, { title: t.stepTitle, fields: [field] });
    }
  }

  const steps: SurveyStep[] = [...byStep.entries()].map(([id, step]) => ({
    id,
    title: step.title,
    description: "",
    fields: step.fields,
  }));

  return { steps, fieldIdsByKey };
}
