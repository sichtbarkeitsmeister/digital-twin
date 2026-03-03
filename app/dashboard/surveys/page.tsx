import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { CopyToClipboardButton } from "@/app/dashboard/_components/copy-to-clipboard-button";
import { SurveysToolbar } from "@/app/dashboard/surveys/_components/surveys-toolbar";
import { SurveyRowActions } from "@/app/dashboard/surveys/_components/survey-row-actions";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

type SearchParams = Record<string, string | string[] | undefined>;
type SearchParamsInput = SearchParams | Promise<SearchParams> | undefined;

function firstParam(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

type PageItem = number | "ellipsis";

function pageItems(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: PageItem[] = [1];

  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);

  if (left > 2) items.push("ellipsis");
  for (let p = left; p <= right; p++) items.push(p);
  if (right < total - 1) items.push("ellipsis");

  items.push(total);
  return items;
}

function visibilityLabel(v: string) {
  return v === "public" ? "Öffentlich" : "Privat";
}

function statusLabel(v: string) {
  if (v === "completed") return "Abgeschlossen";
  if (v === "in_progress") return "In Bearbeitung";
  return v;
}

function countTotalFields(definition: unknown): number {
  if (!isRecord(definition)) return 0;
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  let total = 0;
  for (const st of steps) {
    if (isRecord(st) && Array.isArray(st.fields)) total += st.fields.length;
  }
  return total;
}

function countAnswered(answers: unknown): number {
  if (!isRecord(answers)) return 0;
  return Object.keys(answers).length;
}

function PublicLink({ slug }: { slug: string }) {
  const path = `/s/${slug}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={path} className="text-sm underline underline-offset-4">
        {path}
      </Link>
      <CopyToClipboardButton text={path} label="Link kopieren" />
    </div>
  );
}

export default async function SurveysPage({ searchParams }: { searchParams?: SearchParamsInput }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const userId = user?.id;
  if (authError || !userId) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";
  if (!isPlatformAdmin) {
    redirect("/dashboard/inbox");
  }

  const sp = (await Promise.resolve(searchParams)) ?? {};

  const q = (firstParam(sp.q) ?? "").toString().trim().slice(0, 120);
  const visibilityParam = firstParam(sp.visibility);
  const visibility =
    visibilityParam === "public" || visibilityParam === "private" ? visibilityParam : "all";

  const page = Math.max(1, Number.parseInt(firstParam(sp.page) ?? "1", 10) || 1);
  const pageSizeRaw = Number.parseInt(firstParam(sp.pageSize) ?? "10", 10) || 10;
  const pageSize = ([10, 20, 50] as const).includes(pageSizeRaw as 10 | 20 | 50)
    ? (pageSizeRaw as 10 | 20 | 50)
    : 10;

  let surveysQuery = supabase
    .from("surveys")
    .select("id,title,description,visibility,slug,updated_at,published_at,definition", {
      count: "exact",
    })
    .order("updated_at", { ascending: false });

  if (visibility !== "all") surveysQuery = surveysQuery.eq("visibility", visibility);

  if (q) {
    const qSafe = q.replace(/[(),]/g, " ").trim();
    surveysQuery = surveysQuery.or(
      `title.ilike.%${qSafe}%,description.ilike.%${qSafe}%,slug.ilike.%${qSafe}%`,
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: surveys, count: surveysCount } = await surveysQuery.range(from, to);

  const total = surveysCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (total > 0 && page > totalPages) {
    redirect(
      `/dashboard/surveys${buildQueryString({
        q: q || undefined,
        visibility: visibility === "all" ? undefined : visibility,
        page: totalPages,
        pageSize,
      })}`,
    );
  }

  const surveyIds = (surveys ?? []).map((s) => s.id);
  const { data: responses } =
    surveyIds.length > 0
      ? await supabase
          .from("survey_responses")
          .select("id,survey_id,status,answers,updated_at,completed_at")
          .in("survey_id", surveyIds)
      : { data: [] as Array<{
          id: string;
          survey_id: string;
          status: string;
          answers: unknown;
          updated_at: string;
          completed_at: string | null;
        }> };

  const responseBySurveyId = new Map((responses ?? []).map((r) => [r.survey_id, r]));

  const { data: pendingQuestions } =
    surveyIds.length > 0
      ? await supabase
          .from("survey_field_questions")
          .select("survey_id")
          .in("survey_id", surveyIds)
          .is("answer", null)
      : { data: [] as Array<{ survey_id: string }> };

  const pendingBySurveyId = new Map<string, number>();
  for (const q of pendingQuestions ?? []) {
    pendingBySurveyId.set(q.survey_id, (pendingBySurveyId.get(q.survey_id) ?? 0) + 1);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Umfragen</h1>
          <p className="text-secondary">
            Entwürfe sind standardmäßig privat. Veröffentliche, um per Link zu teilen.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/surveys/new">Neue Umfrage</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alle Umfragen</CardTitle>
          <CardDescription>Erstellen, veröffentlichen und Fortschritt ansehen.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <SurveysToolbar
              initialQuery={q}
              initialVisibility={visibility === "all" ? "" : visibility}
              initialPageSize={pageSize}
            />

            <div className="text-sm text-secondary">
              {total > 0 ? (
                <>
                  {Math.min(from + 1, total)}–{Math.min(from + (surveys?.length ?? 0), total)} von{" "}
                  {total}
                </>
              ) : (
                "0 Ergebnisse"
              )}
            </div>
          </div>

          {surveys?.length ? (
            <div className="overflow-hidden rounded-lg border">
              <div className="divide-y">
                {surveys.map((s) => {
                  const isPublic = s.visibility === "public" && !!s.slug;
                  const response = responseBySurveyId.get(s.id) ?? null;
                  const totalFields = countTotalFields(s.definition);
                  const answered = countAnswered(response?.answers);
                  const pct =
                    totalFields > 0 ? Math.min(100, Math.round((answered / totalFields) * 100)) : 0;
                  const pendingCount = pendingBySurveyId.get(s.id) ?? 0;
                  const responseHref = response?.id
                    ? `/dashboard/surveys/${s.id}/responses/${response.id}`
                    : `/dashboard/surveys/${s.id}/responses`;
                  const editHref = `/dashboard/surveys/${s.id}/edit`;

                  return (
                    <div key={s.id} className="p-4 hover:bg-accent/30">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={responseHref}
                              className="font-semibold truncate underline-offset-4 hover:underline"
                            >
                              {s.title}
                            </Link>

                            <Badge variant={s.visibility === "public" ? "default" : "secondary"}>
                              {visibilityLabel(s.visibility)}
                            </Badge>

                            {pendingCount > 0 ? (
                              <Badge variant="destructive">
                                Frage{pendingCount === 1 ? "" : "n"}: {pendingCount}
                              </Badge>
                            ) : null}

                            <Badge variant="outline">{pct}%</Badge>

                            <span className="text-xs text-secondary">
                              {response?.status ? statusLabel(response.status) : "Noch keine Antwort"}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-col gap-2">
                            <div className="h-2 w-full max-w-[420px] overflow-hidden rounded-full bg-primary/20">
                              <div className="h-2 bg-primary" style={{ width: `${pct}%` }} />
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                              Aktualisiert {new Date(s.updated_at).toLocaleString()}
                              {s.published_at ? (
                                <>
                                  <span>·</span>
                                  Veröffentlicht {new Date(s.published_at).toLocaleString()}
                                </>
                              ) : null}
                            </div>
                          </div>

                          {s.description ? (
                            <p className="mt-2 text-sm text-secondary line-clamp-2">
                              {s.description}
                            </p>
                          ) : null}

                          {isPublic ? (
                            <div className="mt-2">
                              <PublicLink slug={s.slug!} />
                            </div>
                          ) : null}
                        </div>

                        <div className="shrink-0">
                          <SurveyRowActions
                            surveyId={s.id}
                            title={s.title}
                            editHref={editHref}
                            responseHref={responseHref}
                            isPublic={isPublic}
                            pendingCount={pendingCount}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-secondary">
              {q || visibility !== "all"
                ? "Keine Umfragen für diese Filter."
                : "Noch keine Umfragen. Klicke auf „Neue Umfrage“, um deinen ersten Entwurf zu erstellen."}
            </div>
          )}

          {total > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-secondary">
                Seite {clampInt(page, 1, totalPages)} von {totalPages}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {page > 1 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/dashboard/surveys${buildQueryString({
                        q: q || undefined,
                        visibility: visibility === "all" ? undefined : visibility,
                        page: page - 1,
                        pageSize,
                      })}`}
                    >
                      Zurück
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    Zurück
                  </Button>
                )}

                {pageItems(clampInt(page, 1, totalPages), totalPages).map((it, idx) =>
                  it === "ellipsis" ? (
                    <span key={`e-${idx}`} className="px-1 text-sm text-secondary">
                      …
                    </span>
                  ) : it === page ? (
                    <Button key={it} size="sm" disabled>
                      {it}
                    </Button>
                  ) : (
                    <Button key={it} asChild size="sm" variant="outline">
                      <Link
                        href={`/dashboard/surveys${buildQueryString({
                          q: q || undefined,
                          visibility: visibility === "all" ? undefined : visibility,
                          page: it,
                          pageSize,
                        })}`}
                      >
                        {it}
                      </Link>
                    </Button>
                  ),
                )}

                {page < totalPages ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/dashboard/surveys${buildQueryString({
                        q: q || undefined,
                        visibility: visibility === "all" ? undefined : visibility,
                        page: page + 1,
                        pageSize,
                      })}`}
                    >
                      Weiter
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    Weiter
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

