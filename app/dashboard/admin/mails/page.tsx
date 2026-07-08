import Link from "next/link";
import { redirect } from "next/navigation";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Mail, MailX, Send } from "lucide-react";

import { AdminEmailLogTable } from "@/app/dashboard/_components/admin-email-log-table";
import { AdminMailStatusFilters } from "@/app/dashboard/_components/admin-mail-status-filters";
import { AdminTestEmailForm } from "@/app/dashboard/_components/admin-test-email-form";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { orgDetailCardClass } from "@/app/dashboard/_components/organisations/org-overview-panel";
import { getAuthenticatedUserId } from "@/lib/dashboard/org-context";
import { getAppBaseUrl } from "@/lib/email/mailer";
import { getSmtpDiagnostics } from "@/lib/email/send-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const mailCardClass = cn(orgDetailCardClass, "overflow-hidden");

function StatCard(props: {
  label: string;
  value: number;
  tone?: "default" | "muted" | "danger";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;
  return (
    <div className={cn(mailCardClass, "p-4")}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-primary">
            {props.value}
          </p>
          <p className="text-xs text-secondary">{props.label}</p>
        </div>
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            props.tone === "danger" &&
              "bg-red-500/10 text-red-600 dark:text-red-300",
            props.tone === "muted" &&
              "bg-sbkm-navy/8 text-secondary dark:bg-white/10",
            (!props.tone || props.tone === "default") &&
              "bg-sbkm-mint/15 text-sbkm-navy dark:bg-sbkm-mint/10 dark:text-sbkm-mint",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export default function AdminMailsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  return (
    <React.Suspense
      fallback={
        <OrganisationPageShell>
          <div className="grid gap-3">
            <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/30" />
          </div>
        </OrganisationPageShell>
      }
    >
      <AdminMailsPageContent searchParams={searchParams} />
    </React.Suspense>
  );
}

async function AdminMailsPageContent({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status } = await searchParams;
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
    .from("email_send_logs")
    .select(
      "id, kind, status, to_addresses, subject, error_message, smtp_message_id, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);

  const { data: logs, count, error } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const smtp = getSmtpDiagnostics();

  const [sentRes, failedRes, skippedRes] = await Promise.all([
    supabase
      .from("email_send_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
    supabase
      .from("email_send_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("email_send_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "skipped"),
  ]);

  return (
    <OrganisationPageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">E-Mails</h1>
          <p className="max-w-2xl text-sm text-secondary">
            Versandhistorie und SMTP-Debug — Test-E-Mails senden und Fehler nachvollziehen.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Mail className="size-3.5" aria-hidden />
          Plattform-Admin
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Gesendet"
          value={sentRes.count ?? 0}
          icon={CheckCircle2}
        />
        <StatCard
          label="Übersprungen"
          value={skippedRes.count ?? 0}
          tone="muted"
          icon={Mail}
        />
        <StatCard
          label="Fehlgeschlagen"
          value={failedRes.count ?? 0}
          tone="danger"
          icon={MailX}
        />
      </div>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <section className={mailCardClass}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
            <div className="border-b border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
              <h2 className="text-sm font-semibold tracking-tight text-primary">
                SMTP-Status
              </h2>
              <p className="mt-1 text-xs text-secondary">
                Konfiguration aus Umgebungsvariablen (ohne Passwort).
              </p>
            </div>
            <div className="grid gap-4 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]">
                <span className="text-sm text-secondary">Bereit zum Senden</span>
                <Badge variant={smtp.configured ? "outline" : "destructive"}>
                  {smtp.configured ? "Ja" : "Nein"}
                </Badge>
              </div>

              <dl className="grid gap-2.5 text-sm">
                {[
                  ["Host", smtp.host ?? "—"],
                  ["Port", smtp.port],
                  ["User", smtp.user ?? "—"],
                  ["From", smtp.from ?? "—"],
                  ["App-URL", getAppBaseUrl()],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3"
                  >
                    <dt className="text-xs text-secondary">{label}</dt>
                    <dd className="break-all font-mono text-[11px] leading-relaxed text-primary">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              {!smtp.configured ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    SMTP_HOST, SMTP_USER und SMTP_PASS (oder SMTP_PASSWORD) müssen gesetzt sein.
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className={mailCardClass}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
            <div className="border-b border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-sbkm-mint/15 dark:bg-sbkm-mint/10">
                  <Send className="size-4 text-sbkm-navy dark:text-sbkm-mint" aria-hidden />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-primary">
                    Test senden
                  </h2>
                  <p className="text-xs text-secondary">
                    Einfache Test-E-Mail — Ergebnis erscheint in der Historie.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <AdminTestEmailForm />
            </div>
          </section>
        </div>

        <section className={cn(mailCardClass, "min-w-0")}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
          <div className="flex flex-col gap-4 border-b border-sbkm-navy/8 px-4 py-4 dark:border-white/8 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight text-primary">
                  Versandhistorie
                </h2>
                <p className="mt-1 text-xs text-secondary tabular-nums">
                  {count ?? 0} Einträge insgesamt
                  {status
                    ? ` · Filter: ${status === "sent" ? "Gesendet" : status === "failed" ? "Fehlgeschlagen" : "Übersprungen"}`
                    : ""}
                </p>
              </div>
            </div>
            <AdminMailStatusFilters active={status} />
          </div>

          <div className="min-w-0 p-4 sm:p-5">
            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>Historie konnte nicht geladen werden: {error.message}</span>
              </div>
            ) : !logs?.length ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-sbkm-navy/15 px-6 py-12 text-center dark:border-white/15">
                <div className="flex size-11 items-center justify-center rounded-xl bg-sbkm-navy/8 dark:bg-white/10">
                  <Mail className="size-5 text-secondary" aria-hidden />
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-medium text-primary">
                    Noch keine E-Mail-Versände
                  </p>
                  <p className="max-w-sm text-xs text-secondary">
                    Sende eine Test-E-Mail links, oder löse einen Willkommens-Versand aus —
                    alle Versuche erscheinen hier.
                  </p>
                </div>
              </div>
            ) : (
              <AdminEmailLogTable logs={logs} />
            )}

            {totalPages > 1 ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sbkm-navy/8 pt-4 dark:border-white/8">
                <p className="text-xs tabular-nums text-secondary">
                  Seite {page} von {totalPages}
                </p>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/dashboard/admin/mails?page=${page - 1}${status ? `&status=${status}` : ""}`}
                      >
                        Zurück
                      </Link>
                    </Button>
                  ) : null}
                  {page < totalPages ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/dashboard/admin/mails?page=${page + 1}${status ? `&status=${status}` : ""}`}
                      >
                        Weiter
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </OrganisationPageShell>
  );
}
