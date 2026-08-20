import {
  matchSurveyFoldersToOrganisationName,
  pickPreferredSurveyFolder,
} from "@/lib/dt/agent-survey-coverage-options";
import { suggestedSurveyFolderName } from "@/lib/dt/ensure-organisation-survey-folder";

export function pickSurveyFolderToRename(input: {
  folders: Array<{ id: string; name: string }>;
  previousLabels: string[];
  nextName: string;
}): { id: string; from: string; to: string } | null {
  const nextName = suggestedSurveyFolderName({ name: input.nextName });
  const previousLabels = input.previousLabels
    .map((value) => value.trim())
    .filter(Boolean);
  const primary = previousLabels[0];
  if (!primary || !nextName) return null;

  const matched = matchSurveyFoldersToOrganisationName(
    input.folders,
    primary,
    previousLabels.slice(1),
  );
  const preferred = pickPreferredSurveyFolder(matched, previousLabels);
  if (!preferred) return null;
  if (preferred.name.trim() === nextName) return null;

  const taken = input.folders.some(
    (folder) => folder.id !== preferred.id && folder.name.trim() === nextName,
  );
  if (taken) return null;

  return { id: preferred.id, from: preferred.name, to: nextName };
}
