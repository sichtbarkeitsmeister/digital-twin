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

export function PlatformAdminTeamCard(props: {
  members: PlatformTeamMember[];
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(
    setPlatformAdminRoleAction,
    initialState,
  );

  const admins = props.members.filter((m) => m.role === "admin");
  const canDemote = admins.length > 1;

  return (
    <div className="grid gap-8">
      <form
        action={formAction}
        className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-4"
      >
        <div className="grid gap-2">
          <Label htmlFor="platform_admin_email">Kollegin / Kollegen freischalten</Label>
          <Input
            id="platform_admin_email"
            name="email"
            type="email"
            placeholder="vanessa.may@sichtbarkeitsmeister.de"
            autoComplete="email"
            required
            className="h-10"
          />
          <p className="text-xs text-secondary">
            Nach dem Freischalten erscheint ein Anmeldelink — den muss sie einmal anklicken.
            Steckt das Konto fest: <strong>Konto löschen und neu einladen</strong>. Danach den
            Anmeldelink an sie weitergeben.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            name="intent"
            value="grant"
            disabled={pending}
            className="h-10 transition-transform duration-150 active:scale-[0.98]"
          >
            {pending ? "Speichere…" : "Admin-Ansicht geben"}
          </Button>
          <input type="hidden" name="make_admin" value="true" />
          <Button
            type="submit"
            name="intent"
            value="reinvite"
            variant="outline"
            disabled={pending}
            className="h-10"
            onClick={(event) => {
              if (
                !confirm(
                  "Konto wirklich löschen und neu einladen? Offene Sitzungen dieser Adresse werden beendet.",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            Konto löschen und neu einladen
          </Button>
        </div>
      </form>

      {state.message ? (
        <p
          className={state.ok ? "text-sm text-secondary" : "text-sm text-red-500"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}

      {state.inviteLink ? (
        <div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
            Anmeldelink zum Weitergeben:
          </p>
          <code className="break-all text-xs text-primary">{state.inviteLink}</code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.inviteLink!);
              } catch {
                /* ignore */
              }
            }}
          >
            Link kopieren
          </Button>
        </div>
      ) : null}

      <section className="grid max-w-3xl gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-primary">
          Mit Admin-Ansicht
          <span className="ml-2 font-normal text-secondary">{admins.length}</span>
        </h2>
        {admins.length === 0 ? (
          <p className="text-sm text-secondary">Niemand ist Plattform-Admin.</p>
        ) : (
          <ul className="grid gap-2">
            {admins.map((member) => {
              const isSelf = member.id === props.currentUserId;

              return (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {memberInitials(member.email)}
                    </div>
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
                        Plattform-Admin
                      </p>
                    </div>
                  </div>

                  <form action={formAction}>
                    <input type="hidden" name="email" value={member.email} />
                    <input type="hidden" name="make_admin" value="false" />
                    <input type="hidden" name="intent" value="revoke" />
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
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
