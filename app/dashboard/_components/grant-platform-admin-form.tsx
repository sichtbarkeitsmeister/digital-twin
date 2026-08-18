"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { grantPlatformAdminAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { ok: true, message: "" };

export function GrantPlatformAdminForm() {
  const [state, formAction, pending] = useActionState(
    grantPlatformAdminAction,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="platform_admin_email">E-Mail</Label>
        <Input
          id="platform_admin_email"
          name="email"
          type="email"
          placeholder="kollegin@firma.de"
          autoComplete="email"
          required
        />
        <p className="text-xs text-secondary">
          Die Person braucht ein bestehendes Konto (z.&nbsp;B. nach „Mitglied
          einladen“). Danach sieht sie denselben Verwaltungsbereich wie du:
          Organisationen anlegen, Fragebögen, Alle Umfragen.
        </p>
      </div>

      {state.message ? (
        <p
          className={state.ok ? "text-sm text-secondary" : "text-sm text-red-400"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        {pending ? "Wird gesetzt …" : "Verwaltungszugang geben"}
      </Button>
    </form>
  );
}
