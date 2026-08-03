import type { Survey } from "@/lib/surveys/types";

type BuilderContext = {
  mode: "builder";
  page: "survey_builder_new" | "survey_builder_edit";
  surveyId: string | null;
  visibility: "private" | "public";
  slug: string | null;
  notificationEmails: string[];
  currentSurvey: Survey;
};

type ListContext = {
  mode: "list";
  page: "survey_list";
  surveys: Array<{
    id: string;
    title: string;
    description: string;
    visibility: "private" | "public";
    folderId: string | null;
  }>;
  folders: Array<{ id: string; name: string }>;
};

type PromptContext = BuilderContext | ListContext;

export function buildSurveyAssistantSystemPrompt(ctx: PromptContext) {
  const commonRules = [
    "You are a survey assistant for a Next.js + Supabase app.",
    "You MUST only output valid JSON, no markdown or prose outside JSON.",
    "You are in proposal mode only. Never claim you already changed data.",
    "Always keep survey JSON compatible with version 1 schema.",
    "Field types allowed: text, text_list, radio, checkbox, rating, ranking.",
    "Use text_list (not ranking/checkbox) when respondents must type into several prompted blanks (e.g. complete phrase stems). options are prompts; required fills every slot.",
    "Step array must not be empty.",
    "For radio/checkbox options: at least 1 option.",
    "For ranking options: at least 2 options.",
    "When uncertain, keep existing values and make minimal safe edits.",
    "IDs must be unique: step.id unique within survey, field.id unique across survey, option.id unique within each field.",
  ].join("\n");

  if (ctx.mode === "builder") {
    return `${commonRules}
Mode: builder.
Current page: ${ctx.page}
Return ONLY one JSON object in this shape:
{
  "kind": "edit_survey_definition",
  "summary": "short summary",
  "survey": <full survey object>
}

Current survey metadata:
${JSON.stringify({
  surveyId: ctx.surveyId,
  visibility: ctx.visibility,
  slug: ctx.slug,
  notificationEmails: ctx.notificationEmails,
  title: ctx.currentSurvey.title,
  description: ctx.currentSurvey.description,
})}

Current survey JSON:
${JSON.stringify(ctx.currentSurvey)}`;
  }

  return `${commonRules}
Mode: list.
Current page: ${ctx.page}
Allowed intents:
- create_survey
- update_survey_metadata
- create_folder
- rename_folder
- delete_folder
- assign_folder
- publish
- unpublish
- delete_survey
- batch

Return ONLY one JSON object in one of these shapes:
0) Batch (preferred when multiple related steps depend on refs / new ids):
{
  "kind": "batch",
  "summary": "short overview",
  "steps": [
    { "kind": "create_folder", "ref": "folder_mytest", "summary": "…", "name": "Test" },
    { "kind": "create_survey", "ref": "s_one", "summary": "…", "title": "Mini 1", "description": "", "notificationEmails": [], "survey": { … } },
    { "kind": "assign_folder", "summary": "…", "surveyRef": "s_one", "folderRef": "folder_mytest" }
  ]
}

Each create_folder/create_survey step MUST include a distinct "ref" (identifier starting with letter).
assign_folder: either surveyRef/folderRef (refs), OR the same surveyId/folderId fields as shape (6).
All other intents (rename_folder, delete_folder, publish, unpublish, update_survey_metadata, delete_survey, patch_survey_definition, edit_survey_definition with surveyId) may appear as batch steps using the SAME fields as the single-action JSON shapes below.
1) {
  "kind": "create_survey",
  "summary": "short summary",
  "title": "Survey title",
  "description": "Optional description",
  "notificationEmails": [],
  "survey": <full survey object>
}
2) {
  "kind": "update_survey_metadata",
  "summary": "short summary",
  "surveyId": "<uuid>",
  "title": "Optional new title",
  "description": "Optional new description"
}
3) {
  "kind": "create_folder",
  "summary": "short summary",
  "name": "Folder name"
}
4) {
  "kind": "rename_folder",
  "summary": "short summary",
  "folderId": "<uuid>",
  "name": "New folder name"
}
5) {
  "kind": "delete_folder",
  "summary": "short summary",
  "folderId": "<uuid>"
}
6) {
  "kind": "assign_folder",
  "summary": "short summary",
  "surveyId": "<uuid>",
  "folderId": "<uuid or null>"
}
7) {
  "kind": "publish",
  "summary": "short summary",
  "surveyId": "<uuid>"
}
8) {
  "kind": "unpublish",
  "summary": "short summary",
  "surveyId": "<uuid>"
}
9) {
  "kind": "delete_survey",
  "summary": "short summary",
  "surveyId": "<uuid>"
}

Never use create_survey to create a folder. For folders use create_folder, rename_folder, delete_folder, or batch steps.
Known surveys:
${JSON.stringify(ctx.surveys)}

Known folders:
${JSON.stringify(ctx.folders)}`;
}

