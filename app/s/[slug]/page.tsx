import { notFound } from "next/navigation";

import type { Survey } from "@/lib/surveys/types";
import { createClient } from "@/lib/supabase/server";

import { SurveyFill } from "@/app/s/[slug]/_components/survey-fill";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export default async function PublicSurveyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_public_survey_by_slug", { p_slug: slug });
  if (error || !data?.length) return notFound();

  const row = data[0]!;

  const def = (row.definition ?? {}) as unknown;
  const defTitle = isRecord(def) && typeof def.title === "string" ? def.title : "";
  const defDescription = isRecord(def) && typeof def.description === "string" ? def.description : "";
  const survey: Survey = {
    ...(isRecord(def) ? (def as unknown as Survey) : ({} as Survey)),
    title: row.title ?? defTitle,
    description: row.description ?? defDescription,
  } as Survey;

  return <SurveyFill slug={row.slug} survey={survey} />;
}

