"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { transferOwnershipAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { ok: true, message: "" };

export function TransferOwnershipForm({
  organisationId,
  onSuccess,
}: {
  organisationId: string;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    transferOwnershipAction,
    initialState,
  );
  const lastMessage = useRef(state.message);
  const [copied, setCopied] = useState(false);
  const showLink = Boolean(state.ok && state.inviteLink) && !state.emailSent;

  useEffect(() => {
    if (state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      if (state.ok && state.message && !showLink) onSuccess?.();
    }
  }, [state, onSuccess, showLink]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organisation_id" value={organisationId} />

      <div className="grid gap-2">
        <Label htmlFor="new_owner_email">E-Mail des neuen Inhabers</Label>
        <Input
          id="new_owner_email"
          name="new_owner_email"
          type="email"
          placeholder="kollege@firma.de"
          autoComplete="email"
          required
        />
        <p className="text-xs text-secondary">
          Bestehendes Konto oder neue Adresse. Die Person wird Inhaber und erhält
          volle Rechte. Fehlt noch ein Konto, legen wir eines an.
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
          <span className="text-sm font-medium">Einladungs-E-Mail senden</span>
          <span className="text-xs text-secondary">
            Der neue Inhaber erhält einen Ein-Klick-Anmeldelink zum Portal.
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

      {showLink && state.inviteLink ? (
        <div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
            Anmeldelink (manuell teilen, falls die Mail nicht ankommt):
          </p>
          <code className="break-all text-[11px] text-sbkm-navy dark:text-white/80">
            {state.inviteLink}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.inviteLink!);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Kopiert" : "Link kopieren"}
          </Button>
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        variant="destructive"
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        {pending ? "Wird übertragen…" : "Ownership übertragen"}
      </Button>
    </form>
  );
}
