import { NextResponse } from "next/server";

import { parseEmailList, sendEmail, getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";
import { getFieldMetaFromSurveyDefinition } from "@/lib/surveys/utils";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { questionId?: unknown } | null;
    const questionId = typeof body?.questionId === "string" ? body.questionId.trim() : "";
    if (!questionId) {
      return NextResponse.json({ ok: false, message: "Missing questionId." }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: q } = await supabase
      .from("survey_field_questions")
      .select("id,survey_id,response_id,field_id,question,asked_at,asked_notification_sent_at")
      .eq("id", questionId)
      .maybeSingle();

    if (!q?.id) return NextResponse.json({ ok: true, skipped: true });
    if (q.asked_notification_sent_at) return NextResponse.json({ ok: true, skipped: true });

    const { data: survey } = await supabase
      .from("surveys")
      .select("id,title,slug,visibility,definition")
      .eq("id", q.survey_id)
      .maybeSingle();

    if (!survey?.id) return NextResponse.json({ ok: true, skipped: true });

    const fieldMeta = getFieldMetaFromSurveyDefinition(survey.definition, q.field_id);
    const fieldTitle = fieldMeta?.title?.trim() || q.field_id;
    const fieldDescription = fieldMeta?.description?.trim() || "";

    const to = parseEmailList(process.env.SURVEY_NOTIFICATIONS_TO);
    const baseUrl = getAppBaseUrl();
    const publicLink =
      survey.visibility === "public" && survey.slug ? `${baseUrl}/s/${survey.slug}` : null;

    await sendEmail({
      to,
      subject: `Neue Frage: ${survey.title}`,
      text: [
        `Neue Frage wurde gestellt.`,
        ``,
        `Umfrage: ${survey.title}`,
        fieldTitle ? `Feld: ${fieldTitle}` : null,
        fieldDescription ? `Beschreibung: ${fieldDescription}` : null,
        `Frage: ${q.question}`,
        ``,
        publicLink ? `Umfrage öffnen: ${publicLink}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      html: renderBrandedEmail({
        title: `Neue Frage: ${survey.title}`,
        headline: "Neue Frage wurde gestellt",
        intro: "Es gibt eine neue Frage zu einer Umfrage.",
        details: [
          { label: "Umfrage", value: survey.title },
          ...(fieldTitle ? [{ label: "Feld", value: fieldTitle }] : []),
          ...(fieldDescription ? [{ label: "Beschreibung", value: fieldDescription }] : []),
          { label: "Frage", value: q.question },
        ],
        actions: publicLink ? [{ label: "Umfrage öffnen", href: publicLink }] : [],
        preheader: `Neue Frage: ${survey.title}`,
      }),
    });

    await supabase
      .from("survey_field_questions")
      .update({ asked_notification_sent_at: new Date().toISOString() })
      .eq("id", q.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("survey-question-asked notification failed", e);
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
