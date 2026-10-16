import {
  AVATAR_GENERATOR_PROMPT_SLUG,
  resolveAvatarGeneratorPrompt,
} from "@/lib/dt/transcripts/avatar-generator-prompt";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The saved „Anbieter-Avatare“ prompt with the organisation filled in. Read with the service
 * client: the template row is not public, and org managers may run the step too. Any problem
 * (no row, migration not run) means the default from code, never a failed step.
 */
export async function loadAvatarGeneratorPrompt(organisationName: string): Promise<string> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("dt_agent_templates")
      .select("default_prompt")
      .eq("slug", AVATAR_GENERATOR_PROMPT_SLUG)
      .maybeSingle();
    if (error) {
      console.warn("[dt] loadAvatarGeneratorPrompt:", error.message);
      return resolveAvatarGeneratorPrompt(null, organisationName);
    }
    return resolveAvatarGeneratorPrompt((data?.default_prompt as string | null | undefined) ?? null, organisationName);
  } catch (err) {
    console.warn("[dt] loadAvatarGeneratorPrompt:", err);
    return resolveAvatarGeneratorPrompt(null, organisationName);
  }
}
