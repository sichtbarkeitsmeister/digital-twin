"use client";

import { useActionState } from "react";
import { Shield } from "lucide-react";

import {
  setPlatformAdminRoleAction,
  type PlatformAdminRoleActionState,
} from "@/app/dashboard/admin/organisations/actions";
import type { PlatformTeamMember } from "@/lib/dashboard/platform-admin-team";
import { isSbkmStaffEmail } from "@/lib/dt/sbkm-staff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type { PlatformTeamMember };

const initialState: PlatformAdminRoleActionState = { ok: true, message: "" };

export function PlatformAdminTeamCard(props: {
  members: PlatformTeamMember[];
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(
    setPlatformAdminRoleAction,
    initialState,
  );

  const adminCount = props.members.filter((m) => m.role === "admin").length;

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-3">
        <input type="hidden" name="make_admin" value="true" />
        <div className="grid gap-2">
          <Label htmlFor="platform_admin_email">Kollegin / Kollegen freischalten</Label>
          <Input
            id="platform_admin_email"
            name="email"
            type="email"
            placeholder="name@sichtbarkeitsmeister.de"
            autoComplete="email"
            required
          />
          <p className="text-xs text-secondary">
            E-Mail eintragen und freischalten — danach neu laden. Die Admin-Ansicht
            (Verwaltung, SEO Modus) hängt an dieser Plattformrolle, nicht an der
            Organisationsrolle.
          </p>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="w-fit transition-transform duration-150 active:scale-[0.98]"
        >
          {pending ? "Speichere…" : "Admin-Ansicht geben"}
        </Button>
      </form>

      {state.message ? (
        <p
          className={state.ok ? "text-sm text-secondary" : "text-sm text-red-500"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}

      {props.members.length === 0 ? (
        <p className="text-sm text-secondary">Noch keine Konten sichtbar.</p>
      ) : (
        <ul className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
          {props.members.map((member) => {
            const isAdmin = member.role === "admin";
            const isSelf = member.id === props.currentUserId;
            const canDemote = isAdmin && adminCount > 1;

            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2.5"
              >
                <div className="min-w-0 grid gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-primary">
                      {member.email}
                    </span>
                    {isSelf ? <Badge variant="secondary">Du</Badge> : null}
                    {isSbkmStaffEmail(member.email) ? (
                      <Badge variant="outline">SBKM</Badge>
                    ) : null}
                  </div>
                  <p className="flex items-center gap-1 text-xs text-secondary">
                    <Shield className="size-3" aria-hidden />
                    {isAdmin ? "Plattform-Admin" : "Kunde — ohne Admin-Ansicht"}
                  </p>
                </div>

                {isAdmin ? (
                  <form action={formAction}>
                    <input type="hidden" name="email" value={member.email} />
                    <input type="hidden" name="make_admin" value="false" />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={pending || !canDemote}
                      className={cn("shrink-0", !canDemote && "opacity-60")}
                    >
                      Entfernen
                    </Button>
                  </form>
                ) : (
                  <form action={formAction}>
                    <input type="hidden" name="email" value={member.email} />
                    <input type="hidden" name="make_admin" value="true" />
                    <Button type="submit" size="sm" disabled={pending} className="shrink-0">
                      Freischalten
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
