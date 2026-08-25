/**
 * Individualisiert Kernfragen: Unternehmensart (Kunde/Patient/Mandant)
 * und Optionslisten aus Crawl/Impressum/KI.
 */

import { applyClientAudienceToText, type ClientAudienceKind } from "@/lib/surveys/client-audience";
import type { CoreQuestionTemplate } from "@/lib/surveys/core-question-templates";
import { isIndustryPlaceholderLabel } from "@/lib/surveys/core-question-templates";
import type { SurveyOption } from "@/lib/surveys/types";

const SERVICE_OPTION_KEYS = new Set(["portfolio", "services_ranked"]);
const INDUSTRY_OPTION_KEYS = new Set([
  "portfolio",
  "services_ranked",
  "persona_budget",
  "persona_goals",
  "persona_objections",
  "persona_alternatives",
]);

function opt(prefix: string, index: number, label: string): SurveyOption {
  return { id: `${prefix}_${index + 1}`, label };
}

export function optionsFromLabels(prefix: string, labels: string[]): SurveyOption[] {
  return labels
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .slice(0, 10)
    .map((label, index) => opt(prefix, index, label));
}

export function templateHasPlaceholderOptions(template: CoreQuestionTemplate): boolean {
  return (template.options ?? []).some((option) => isIndustryPlaceholderLabel(option.label));
}

function optionPrefixFor(template: CoreQuestionTemplate): string {
  const first = template.options?.[0]?.id ?? "";
  const stripped = first.replace(/_\d+$/, "");
  return stripped || template.key;
}

export function applyOptionLabels(
  template: CoreQuestionTemplate,
  labels: string[],
): CoreQuestionTemplate {
  const cleaned = labels.map((label) => label.trim()).filter((label) => label.length > 0);
  if (cleaned.length === 0) return template;
  return {
    ...template,
    options: optionsFromLabels(optionPrefixFor(template), cleaned),
  };
}

function mapText(text: string, audience: ClientAudienceKind, replaceBusiness: boolean): string {
  return applyClientAudienceToText(text, audience, { replaceBusiness });
}

export function customizeCoreQuestion(input: {
  template: CoreQuestionTemplate;
  audience: ClientAudienceKind;
  serviceLabels?: string[];
  optionSets?: Record<string, string[]>;
}): CoreQuestionTemplate {
  const { audience } = input;
  const replaceBusiness = !input.template.stepId.includes("persona");
  let next: CoreQuestionTemplate = {
    ...input.template,
    title: mapText(input.template.title, audience, replaceBusiness),
    description: mapText(input.template.description, audience, replaceBusiness),
    stepTitle: mapText(input.template.stepTitle, audience, replaceBusiness),
    stepDescription: input.template.stepDescription
      ? mapText(input.template.stepDescription, audience, replaceBusiness)
      : input.template.stepDescription,
    addEntryLabel: input.template.addEntryLabel
      ? mapText(input.template.addEntryLabel, audience, replaceBusiness)
      : input.template.addEntryLabel,
    options: (input.template.options ?? []).map((option) => ({
      ...option,
      label: mapText(option.label, audience, replaceBusiness),
    })),
  };

  const fromSet = input.optionSets?.[next.key];
  if (fromSet && fromSet.length > 0 && INDUSTRY_OPTION_KEYS.has(next.key)) {
    next = applyOptionLabels(next, fromSet);
  } else if (SERVICE_OPTION_KEYS.has(next.key) && (input.serviceLabels?.length ?? 0) > 0) {
    next = applyOptionLabels(next, input.serviceLabels ?? []);
  }

  return next;
}

export function customizeCoreQuestions(input: {
  templates: CoreQuestionTemplate[];
  audience: ClientAudienceKind;
  serviceLabels?: string[];
  optionSets?: Record<string, string[]>;
}): CoreQuestionTemplate[] {
  return input.templates.map((template) =>
    customizeCoreQuestion({
      template,
      audience: input.audience,
      serviceLabels: input.serviceLabels,
      optionSets: input.optionSets,
    }),
  );
}
