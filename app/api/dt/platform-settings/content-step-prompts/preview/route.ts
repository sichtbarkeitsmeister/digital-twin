import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { contentStepPromptPreview } from "@/lib/dt/content/pipeline/step-preview";
import { CONTENT_STEP_PROMPT_KEYS, CONTENT_STEP_PROMPT_MAX_CHARS, loadContentStepPrompts } from "@/lib/dt/content/step-prompts";
import { loadTexterPrompt } from "@/lib/dt/content/texter-prompt";
import { CONTENT_TYPE_PROMPT_KEYS } from "@/lib/dt/content/type-prompts";
import { loadContentTypePromptsForRun } from "@/lib/dt/content/type-prompts-db";
import { createServiceClient } from "@/lib/supabase/service";

const previewSchema = z.object({
  key: z.enum(CONTENT_STEP_PROMPT_KEYS),
  /** The card's draft; without it the saved text (or the default) is shown. */
  prompt: z.string().max(CONTENT_STEP_PROMPT_MAX_CHARS).optional(),
  page_type: z.enum(CONTENT_TYPE_PROMPT_KEYS).optional(),
});

/** The full prompt of one step for an example page. Reads only; nothing is saved or sent to the model. */
export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Nur für Administratoren." }, { status: 403 });
  }

  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." }, { status: 400 });
  }
  const { key, prompt, page_type: pageType = "unterseite" } = parsed.data;

  try {
    const service = createServiceClient();
    const [stepPrompts, texterPrompt, typePrompts] = await Promise.all([
      loadContentStepPrompts(service),
      loadTexterPrompt(service),
      loadContentTypePromptsForRun(service),
    ]);
    const preview = contentStepPromptPreview({
      key,
      pageType,
      stepPrompts: prompt === undefined ? stepPrompts : { ...stepPrompts, [key]: prompt },
      texterPrompt,
      typePrompts,
    });
    return NextResponse.json({ ok: true, page_type: pageType, ...preview });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Vorschau konnte nicht erstellt werden." },
      { status: 500 },
    );
  }
}
