export const DT_TRANSCRIPT_STATUSES = [
  "uploaded",
  "processing",
  "processed",
  "error",
] as const;

export type DtTranscriptStatus = (typeof DT_TRANSCRIPT_STATUSES)[number];

export type DtTranscriptPersonaExtract = {
  name: string;
  role: string | null;
  priority: "A" | "B" | "C";
  isPrimary: boolean;
  description: string;
  goals: string | null;
  pains: string | null;
  objections: string | null;
  language: string | null;
  buyingTriggers: string | null;
  promptAppend: string;
};

export type DtTranscriptExtract = {
  title: string | null;
  summary: string;
  anbieterMarkdown: string;
  personas: DtTranscriptPersonaExtract[];
};

export type DtMeetingTranscriptRow = {
  id: string;
  organisation_id: string;
  filename: string | null;
  mime_type: string | null;
  title: string | null;
  notes: string | null;
  raw_text: string;
  summary: string | null;
  anbieter_markdown: string | null;
  personas_json: unknown;
  status: DtTranscriptStatus;
  error_message: string | null;
  applied_at: string | null;
  uploaded_by: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DtTranscriptListItem = {
  id: string;
  organisationId: string;
  filename: string | null;
  mimeType: string | null;
  title: string | null;
  notes: string | null;
  summary: string | null;
  anbieterMarkdown: string | null;
  personas: DtTranscriptPersonaExtract[];
  status: DtTranscriptStatus;
  errorMessage: string | null;
  appliedAt: string | null;
  uploadedBy: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rawTextChars: number;
};

export type DtTranscriptDetail = DtTranscriptListItem & {
  rawText: string;
};

export const TRANSCRIPT_ANBIETER_START = "<!-- DT_TRANSCRIPT_ANBIETER_START -->";
export const TRANSCRIPT_ANBIETER_END = "<!-- DT_TRANSCRIPT_ANBIETER_END -->";
export const TRANSCRIPT_PERSONA_START = "<!-- DT_TRANSCRIPT_PERSONA_START -->";
export const TRANSCRIPT_PERSONA_END = "<!-- DT_TRANSCRIPT_PERSONA_END -->";

export const DT_TRANSCRIPT_MAX_RAW_CHARS = 150_000;
export const DT_TRANSCRIPT_LLM_CHARS = 36_000;
