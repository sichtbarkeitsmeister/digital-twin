import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthenticatedUserId } from "@/lib/dashboard/org-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  running: "default",
  succeeded: "outline",
  failed: "destructive",
  dead: "destructive",
};

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function preview(value: unknown, max = 140) {
  try {
    const text = JSON.stringify(value);
    return text.length <= max ? text : `${text.slice(0, max)}…`;
  } catch {
    return "—";
  }
}

export default async function JobsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; kind?: string }>;
}) {
  const { page: pageParam, status, kind } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { supabase, userId } = await getAuthenticatedUserId();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  let query = supabase
    .from("jobs")
    .select(
      "id, kind, status, organisation_id, attempts, max_attempts, run_after, last_error, created_at, completed_at, payload, result",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (kind) query = query.eq("kind", kind);

  const { data: jobs, count, error } = await query;

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const [pendingRes, runningRes, deadRes] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "dead"),
  ]);

  const filterQuery = [
    status ? `status=${status}` : null,
    kind ? `kind=${kind}` : null,
  ]
    .filter(Boolean)
    .join("&");
  const baseQuery = filterQuery ? `?${filterQuery}` : "";

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Jobs runner
        </h1>
        <p className="text-secondary">
          Hintergrundaufträge des Lead-Agenten. Plattform-Admin only.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Gesamt" value={count ?? 0} />
        <KpiTile label="Pending" value={pendingRes.count ?? 0} />
        <KpiTile label="Running" value={runningRes.count ?? 0} />
        <KpiTile label="Dead" value={deadRes.count ?? 0} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant={!status ? "default" : "outline"} size="sm">
          <Link href="/dashboard/admin/jobs">Alle</Link>
        </Button>
        {(["pending", "running", "succeeded", "failed", "dead"] as const).map(
          (s) => (
            <Button
              key={s}
              asChild
              variant={status === s ? "default" : "outline"}
              size="sm"
            >
              <Link href={`/dashboard/admin/jobs?status=${s}`}>{s}</Link>
            </Button>
          ),
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Jobs</CardTitle>
              <CardDescription>{count ?? 0} jobs</CardDescription>
            </div>
            <Badge variant="secondary">
              Seite {page} / {totalPages}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? (
            <p className="text-sm text-red-400">{error.message}</p>
          ) : (jobs ?? []).length === 0 ? (
            <p className="text-sm text-secondary">Keine Jobs.</p>
          ) : (
            (jobs ?? []).map((j) => (
              <div key={j.id} className="rounded-lg border px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-secondary truncate">
                      {j.id}
                    </p>
                    <p className="font-medium text-primary">{j.kind}</p>
                    <p className="text-xs text-secondary">
                      Erstellt {formatTimestamp(j.created_at)}
                      {j.completed_at
                        ? ` · Beendet ${formatTimestamp(j.completed_at)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[j.status] ?? "secondary"}>
                      {j.status}
                    </Badge>
                    <Badge variant="outline">
                      {j.attempts}/{j.max_attempts}
                    </Badge>
                  </div>
                </div>
                <p className="mt-2 font-mono text-xs text-secondary">
                  payload: {preview(j.payload)}
                </p>
                {j.result ? (
                  <p className="mt-1 font-mono text-xs text-secondary">
                    result: {preview(j.result)}
                  </p>
                ) : null}
                {j.last_error ? (
                  <p className="mt-1 break-all font-mono text-xs text-red-400">
                    error: {j.last_error}
                  </p>
                ) : null}
              </div>
            ))
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/admin/jobs${baseQuery}${baseQuery ? "&" : "?"}page=${page - 1}`}
                >
                  Zurück
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/admin/jobs${baseQuery}${baseQuery ? "&" : "?"}page=${page + 1}`}
                >
                  Weiter
                </Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="grid gap-1 p-4">
        <p className="text-xs uppercase tracking-wide text-secondary">{label}</p>
        <p className="text-2xl font-semibold text-primary">{value}</p>
      </CardContent>
    </Card>
  );
}
