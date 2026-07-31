/** Shared Survey KI attachment limits — safe for browser and server bundles. */

export const SURVEY_AI_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const SURVEY_AI_MAX_ATTACHMENTS = 6;
/** Max characters for a chat message body (questionnaire pastes need headroom). */
export const SURVEY_AI_MAX_MESSAGE_CHARS = 50_000;
export const SURVEY_AI_ATTACHMENT_ACCEPT_ATTR =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,.md,.txt,.json,.csv,application/json";

const MULTIMODAL_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const MULTIMODAL_MIME_APPLICATION_PDF = "application/pdf";

export function normalizeSurveyAiMime(mimeType: string): string {
  return mimeType.trim().split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isSurveyAiMultimodalMime(mimeType: string): boolean {
  const m = normalizeSurveyAiMime(mimeType);
  return MULTIMODAL_IMAGE_MEDIA_TYPES.has(m) || m === MULTIMODAL_MIME_APPLICATION_PDF;
}

export function isSurveyAiMultimodalImageMime(mimeType: string): boolean {
  return MULTIMODAL_IMAGE_MEDIA_TYPES.has(normalizeSurveyAiMime(mimeType));
}

export function isSurveyAiMultimodalPdfMime(mimeType: string): boolean {
  return normalizeSurveyAiMime(mimeType) === MULTIMODAL_MIME_APPLICATION_PDF;
}
