import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildSurveyAssistantSystemPrompt } from "@/lib/ai/survey-assistant-prompt";
import {
  parseSurveyAiProposal,
  surveyAiRouteResponseSchema,
} from "@/lib/ai/survey-assistant-types";
import { createClient } from "@/lib/supabase/server";
import { surveySchema } from "@/lib/surveys/schema";

const MODEL_FALLBACKS = ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest"] as const;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  context: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("builder"),
      page: z.enum(["survey_builder_new", "survey_builder_edit"]),
      surveyId: z.string().uuid().nullable(),
      visibility: z.enum(["private", "public"]),
      slug: z.string().nullable(),
      notificationEmails: z.array(z.string()),
      currentSurvey: surveySchema,
    }),
    z.object({
      mode: z.literal("list"),
      page: z.literal("survey_list"),
      surveys: z.array(
        z.object({
          id: z.string().uuid(),
          title: z.string(),
          description: z.string(),
          visibility: z.enum(["private", "public"]),
          folderId: z.string().uuid().nullable(),
        }),
      ),
      folders: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    }),
  ]),
});

function extractText(resp: Anthropic.Messages.Message) {
  return resp.content
    .filter((item): item is Anthropic.TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function stripCodeFences(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

function isModelNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    status?: unknown;
    type?: unknown;
    error?: { type?: unknown; message?: unknown };
  };
  const status = typeof maybe.status === "number" ? maybe.status : null;
  const topType = typeof maybe.type === "string" ? maybe.type : "";
  const innerType = typeof maybe.error?.type === "string" ? maybe.error.type : "";
  const innerMessage = typeof maybe.error?.message === "string" ? maybe.error.message : "";
  return (
    status === 404 &&
    (topType === "not_found_error" ||
      innerType === "not_found_error" ||
      innerMessage.includes("model:"))
  );
}

export async function POST(req: Request) {
  const parsedReq = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedReq.success) {
    return NextResponse.json(
      { ok: false, message: parsedReq.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.id) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Forbidden." }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const preferredModel = process.env.ANTHROPIC_SURVEY_MODEL?.trim() || MODEL_FALLBACKS[0];
  const modelsToTry = Array.from(new Set([preferredModel, ...MODEL_FALLBACKS]));
  const anthropic = new Anthropic({ apiKey });

  try {
    let response: Anthropic.Messages.Message | null = null;
    let lastError: unknown = null;

    for (const model of modelsToTry) {
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: buildSurveyAssistantSystemPrompt(parsedReq.data.context),
          messages: [{ role: "user", content: parsedReq.data.prompt }],
        });
        break;
      } catch (error) {
        lastError = error;
        if (isModelNotFoundError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!response) {
      console.error("Survey AI model selection failed", {
        preferredModel,
        modelsToTry,
        lastError,
      });
      return NextResponse.json(
        {
          ok: false,
          message:
            "AI model unavailable. Set ANTHROPIC_SURVEY_MODEL to a valid model (e.g. claude-sonnet-4-20250514).",
        },
        { status: 500 },
      );
    }

    const text = extractText(response);
    const jsonText = stripCodeFences(text);
    const parsedJson: unknown = JSON.parse(jsonText);
    const proposalParsed = parseSurveyAiProposal(parsedJson);
    if (!proposalParsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message:
            proposalParsed.error.issues[0]?.message ??
            "AI output did not match the expected proposal format.",
        },
        { status: 422 },
      );
    }

    if (
      parsedReq.data.context.mode === "builder" &&
      proposalParsed.data.kind !== "edit_survey_definition"
    ) {
      return NextResponse.json(
        { ok: false, message: "Builder mode only supports survey definition edits." },
        { status: 422 },
      );
    }

    if (
      parsedReq.data.context.mode === "list" &&
      proposalParsed.data.kind === "edit_survey_definition"
    ) {
      return NextResponse.json(
        { ok: false, message: "List mode does not support direct builder-only edits." },
        { status: 422 },
      );
    }

    const body = { ok: true, message: "Vorschlag erstellt.", proposal: proposalParsed.data };
    const finalParsed = surveyAiRouteResponseSchema.safeParse(body);
    if (!finalParsed.success) {
      return NextResponse.json(
        { ok: false, message: "Internal response validation failed." },
        { status: 500 },
      );
    }
    return NextResponse.json(finalParsed.data);
  } catch (error) {
    console.error("Survey AI request failed", error);
    return NextResponse.json(
      { ok: false, message: "AI request failed. Please try again." },
      { status: 500 },
    );
  }
}

