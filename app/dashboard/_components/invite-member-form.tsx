"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { inviteToOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: ActionState = { ok: true, message: "", emailSent: false };

export function InviteMemberForm({
  organisationId,
  onSuccess,
  initialEmail,
  submitLabel,
}: {
  organisationId: string;
  onSuccess?: (message: string) => void;
  /** Prefill for resend flows. */
  initialEmail?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(
    inviteToOrganisationAction,
    initialState,
  );
  const lastMessage = useRef(state.message);

  useEffect(() => {
    if (state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      // Only close when the invitation email was actually sent.
      if (state.emailSent && state.message) onSuccess?.(state.message);
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="organisation_id" value={organisationId} />

      <div className="grid gap-2">
        <Label htmlFor="invited_email">E-Mail</Label>
        <Input
          id="invited_email"
          name="invited_email"
          type="email"
          placeholder="kollege@firma.de"
          autoComplete="email"
          defaultValue={initialEmail ?? ""}
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="role">Rolle</Label>
        <Select id="role" name="role" defaultValue="employee" required>
          <option value="employee">Mitarbeiter</option>
          <option value="admin">Admin</option>
        </Select>
      </div>

      {state.message ? (
        <p
          className={
            state.emailSent ? "text-sm text-secondary" : "text-sm text-red-400"
          }
          role="status"
        >
          {state.message}
          {!state.emailSent ? (
            <>
              {" "}
              Details unter{" "}
              <a className="underline underline-offset-2" href="/dashboard/admin/mails">
                Verwaltung → E-Mails
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="active:scale-[0.98]">
        {pending ? "Wird gesendet …" : submitLabel ?? "Einladen & E-Mail senden"}
      </Button>
    </form>
  );
}
