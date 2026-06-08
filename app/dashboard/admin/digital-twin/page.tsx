import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadDtAdminOrgOverview } from "@/lib/dt/admin-overview";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDigitalTwinPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    redirect("/dashboard/inbox");
  }

  const rows = await loadDtAdminOrgOverview();

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            DigitalTwin Admin
          </h1>
          <p className="text-secondary">
            Übersicht aller Organisationen mit Twin- und SEO-Status.
          </p>
        </div>
        <Badge>Admin</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organisationen</CardTitle>
          <CardDescription>
            Agenten, Mitglieder, SEO-Flag und letzter Report-Lauf.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-secondary">
                <th className="py-2 pr-4 font-semibold">Organisation</th>
                <th className="py-2 pr-4 font-semibold">Twin</th>
                <th className="py-2 pr-4 font-semibold">SEO</th>
                <th className="py-2 pr-4 font-semibold tabular-nums">Agenten</th>
                <th className="py-2 pr-4 font-semibold tabular-nums">Mitglieder</th>
                <th className="py-2 pr-4 font-semibold">Letzter Report</th>
                <th className="py-2 font-semibold">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.organisationId} className="border-b border-border/60">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-primary">{row.displayName ?? row.name}</p>
                    {row.slug ? (
                      <p className="text-xs text-secondary">{row.slug}</p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    {row.twinProvisioned ? (
                      <Badge variant="secondary">aktiv</Badge>
                    ) : (
                      <Badge variant="outline">offen</Badge>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {row.seoEnabled ? (
                      <Badge>SEO</Badge>
                    ) : (
                      <span className="text-secondary">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{row.agentCount}</td>
                  <td className="py-3 pr-4 tabular-nums">{row.memberCount}</td>
                  <td className="py-3 pr-4 text-secondary">
                    {row.lastReportAt
                      ? new Date(row.lastReportAt).toLocaleDateString("de-DE")
                      : "—"}
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/?org=${row.organisationId}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Öffnen
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="py-6 text-sm text-secondary">Keine Organisationen gefunden.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
