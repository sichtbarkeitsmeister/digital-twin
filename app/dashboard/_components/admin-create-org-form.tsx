"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { adminCreateOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { ok: true, message: "" };

export function AdminCreateOrgForm() {
  const [state, formAction, pending] = useActionState(
    adminCreateOrganisationAction,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="org_name">Organisationsname</Label>
        <Input
          id="org_name"
          name="org_name"
          placeholder="Acme GmbH"
          autoComplete="organization"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="org_slug">Slug (optional)</Label>
        <Input
          id="org_slug"
          name="org_slug"
          placeholder="acme-gmbh"
          autoComplete="off"
        />
        <p className="text-xs text-secondary">
          Nur Kleinbuchstaben, Zahlen und Bindestriche. Wird in URLs verwendet.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="owner_email">E-Mail des Inhabers</Label>
        <Input
          id="owner_email"
          name="owner_email"
          type="email"
          placeholder="inhaber@firma.de"
          autoComplete="email"
          required
        />
        <p className="text-xs text-secondary">
          Die Person braucht ein bestehendes Konto und wird automatisch
          Inhaber.
        </p>
      </div>

      {state.message ? (
        <p
          className={
            state.ok ? "text-sm text-secondary" : "text-sm text-red-400"
          }
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
        {pending ? "Wird erstellt …" : "Organisation anlegen"}
      </Button>
    </form>
  );
}
