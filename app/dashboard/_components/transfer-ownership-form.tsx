"use client";

import { useActionState, useEffect, useRef } from "react";
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

  useEffect(() => {
    if (state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      if (state.ok && state.message) onSuccess?.();
    }
  }, [state, onSuccess]);

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
          Die Person braucht ein bestehendes Konto. Sie wird automatisch
          Inhaber und erhält volle Rechte.
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
          <span className="text-sm font-medium">Willkommens-E-Mail senden</span>
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
        >
          {state.message}
        </p>
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
