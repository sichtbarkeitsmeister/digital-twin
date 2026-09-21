export const DT_ONBOARDING_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
]);

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
};

export function guessOnboardingMime(fileName: string, declared: string | null): string {
  const fromType = (declared ?? "").trim().toLowerCase();
  if (fromType && DT_ONBOARDING_ALLOWED_MIMES.has(fromType)) return fromType;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "";
}
