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
          placeholder="wird aus dem Namen erzeugt"
          autoComplete="off"
        />
        <p className="text-xs text-secondary">
          Leer lassen = automatisch aus dem Organisationsnamen. Du kannst auch den
          Firmennamen eintragen — er wird zu einem Slug normalisiert (a-z, 0-9, Bindestriche),
          z.&nbsp;B. „MSH Rechtsanwälte“ → <code className="text-xs">msh-rechtsanwaelte</code>.
          Wird für SEO/n8n als Client-Key genutzt.
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
          Bestehendes Konto oder neue Adresse — bei Einladungs-E-Mail wird bei
          Bedarf automatisch ein Konto angelegt und ein Anmeldelink verschickt.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
        <input
          type="checkbox"
          name="send_welcome"
          value="on"
          defaultChecked
          className="mt-0.5 h-4 w-4 shrink-0 rounded border border-primary accent-primary"
        />
        <span className="grid gap-1">
          <span className="text-sm font-medium">Einladungs-E-Mail an Inhaber senden</span>
          <span className="text-xs text-secondary">
            Einladung mit Ein-Klick-Anmeldelink zum DigitalTwin-Portal.
          </span>
        </span>
      </label>

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

      {state.inviteLink && !state.emailSent ? (
        <div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
            Anmeldelink zum Weitergeben (falls die Mail nicht ankommt):
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
