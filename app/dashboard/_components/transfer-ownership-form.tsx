"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { transferOwnershipAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = { ok: true, message: "" };

export function TransferOwnershipForm({
  organisationId,
}: {
  organisationId: string;
}) {
  const [state, formAction, pending] = useActionState(
    transferOwnershipAction,
    initialState,
  );

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
