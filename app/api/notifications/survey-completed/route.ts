import { NextResponse } from "next/server";

import { parseEmailList, sendEmail, getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { slug?: unknown } | null;
    const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
    if (!slug) return NextResponse.json({ ok: false, message: "Missing slug." }, { status: 400 });

    const supabase = createServiceClient();

    const { data: survey } = await supabase
      .from("surveys")
      .select("id,title,slug")
      .eq("slug", slug)
      .eq("visibility", "public")
      .maybeSingle();

    if (!survey?.id) return NextResponse.json({ ok: true, skipped: true });

    const { data: response } = await supabase
      .from("survey_responses")
      .select("id,status,completed_at,completed_notification_sent_at")
      .eq("survey_id", survey.id)
      .maybeSingle();

    if (!response?.id) return NextResponse.json({ ok: true, skipped: true });
    if (response.status !== "completed") return NextResponse.json({ ok: true, skipped: true });
    if (response.completed_notification_sent_at) return NextResponse.json({ ok: true, skipped: true });

    const to = parseEmailList(process.env.SURVEY_NOTIFICATIONS_TO);
    const baseUrl = getAppBaseUrl();
    const responsesLink = `${baseUrl}/dashboard/surveys/${survey.id}/responses/${response.id}`;

    await sendEmail({
      to,
      subject: `Umfrage abgeschlossen: ${survey.title}`,
      text: `Die Umfrage wurde abgeschlossen.\n\nUmfrage: ${survey.title}\nAntworten ansehen: ${responsesLink}\n`,
      html: renderBrandedEmail({
        title: `Umfrage abgeschlossen: ${survey.title}`,
        headline: "Umfrage abgeschlossen",
        intro: "Eine Umfrage wurde abgeschlossen.",
        details: [{ label: "Umfrage", value: survey.title }],
        actions: [{ label: "Antworten ansehen", href: responsesLink }],
        preheader: `Abgeschlossen: ${survey.title}`,
      }),
    });

    await supabase
      .from("survey_responses")
      .update({ completed_notification_sent_at: new Date().toISOString() })
      .eq("id", response.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("survey-completed notification failed", e);
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
