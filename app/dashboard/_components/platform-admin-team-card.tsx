"use client";

import { useActionState } from "react";
import { Shield } from "lucide-react";

import {
  setPlatformAdminRoleAction,
  type PlatformAdminRoleActionState,
} from "@/app/dashboard/admin/organisations/actions";
import type { PlatformTeamMember } from "@/lib/dashboard/platform-admin-team";
import { isSbkmStaffEmail } from "@/lib/dt/sbkm-staff";
import { memberInitials } from "@/lib/dashboard/organisation-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type { PlatformTeamMember };

const initialState: PlatformAdminRoleActionState = { ok: true, message: "" };

function MemberRow(props: {
  member: PlatformTeamMember;
  isSelf: boolean;
  formAction: (payload: FormData) => void;
  pending: boolean;
  canDemote: boolean;
}) {
  const isAdmin = props.member.role === "admin";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 px-4 py-3 transition-colors hover:bg-muted/30">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            isAdmin ? "bg-primary/15 text-primary" : "bg-muted text-secondary",
          )}
        >
          {memberInitials(props.member.email)}
        </div>
        <div className="min-w-0 grid gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-primary">
              {props.member.email}
            </span>
            {props.isSelf ? <Badge variant="secondary">Du</Badge> : null}
            {isSbkmStaffEmail(props.member.email) ? (
              <Badge variant="outline">SBKM</Badge>
            ) : null}
          </div>
          <p className="flex items-center gap-1 text-xs text-secondary">
            <Shield className="size-3" aria-hidden />
            {isAdmin ? "Plattform-Admin" : "Ohne Admin-Ansicht"}
          </p>
        </div>
      </div>

      {isAdmin ? (
        <form action={props.formAction}>
          <input type="hidden" name="email" value={props.member.email} />
          <input type="hidden" name="make_admin" value="false" />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={props.pending || !props.canDemote}
            className={cn("shrink-0", !props.canDemote && "opacity-60")}
          >
            Entfernen
          </Button>
        </form>
      ) : (
        <form action={props.formAction}>
          <input type="hidden" name="email" value={props.member.email} />
          <input type="hidden" name="make_admin" value="true" />
          <Button type="submit" size="sm" disabled={props.pending} className="shrink-0">
            Freischalten
          </Button>
        </form>
      )}
    </li>
  );
}

export function PlatformAdminTeamCard(props: {
  members: PlatformTeamMember[];
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(
    setPlatformAdminRoleAction,
    initialState,
  );

  const admins = props.members.filter((m) => m.role === "admin");
  const customers = props.members.filter((m) => m.role !== "admin");
  const canDemote = admins.length > 1;

  return (
    <div className="grid gap-8">
      <form
        action={formAction}
        className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      >
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
            className="h-10"
          />
        </div>
        <Button
          type="submit"
          disabled={pending}
          className="h-10 transition-transform duration-150 active:scale-[0.98]"
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
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-primary">
              Mit Admin-Ansicht
              <span className="ml-2 font-normal text-secondary">{admins.length}</span>
            </h2>
            {admins.length === 0 ? (
              <p className="text-sm text-secondary">Niemand ist Plattform-Admin.</p>
            ) : (
              <ul className="grid gap-2">
                {admins.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isSelf={member.id === props.currentUserId}
                    formAction={formAction}
                    pending={pending}
                    canDemote={canDemote}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-primary">
              Ohne Admin-Ansicht
              <span className="ml-2 font-normal text-secondary">{customers.length}</span>
            </h2>
            {customers.length === 0 ? (
              <p className="text-sm text-secondary">Alle Konten haben die Admin-Ansicht.</p>
            ) : (
              <ul className="grid gap-2">
                {customers.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isSelf={member.id === props.currentUserId}
                    formAction={formAction}
                    pending={pending}
                    canDemote={canDemote}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
