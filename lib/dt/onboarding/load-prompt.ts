import "server-only";

import { getAppBaseUrl } from "@/lib/email/mailer";
import { formatOnboardingForPrompt } from "@/lib/dt/onboarding/prompt";
import { countOnboardingFiles, loadOnboarding } from "@/lib/dt/onboarding/store";

export async function loadOnboardingPromptText(organisationId: string): Promise<string> {
  try {
    const [{ record, exists }, fileCount] = await Promise.all([
      loadOnboarding(organisationId),
      countOnboardingFiles(organisationId),
    ]);
    return formatOnboardingForPrompt({
      record: exists ? record : null,
      organisationId,
      fileCount,
      appBaseUrl: getAppBaseUrl(),
    });
  } catch (err) {
    console.error(
      "[onboarding] prompt:",
      err instanceof Error ? err.message : err,
    );
    return formatOnboardingForPrompt({
      record: null,
      organisationId,
      fileCount: 0,
      appBaseUrl: getAppBaseUrl(),
    });
  }
}
