"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/dashboard/actions";
import { inviteToOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: ActionState = {
  ok: true,
  message: "",
  emailSent: false,
  inviteLink: null,
  selfJoined: false,
};

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      // Close when mail went out OR self-invite joined without needing mail.
      if ((state.emailSent || state.selfJoined) && state.message) {
        onSuccess?.(state.message);
      }
    }
  }, [state, onSuccess]);

  const showLink = Boolean(state.inviteLink) && !state.emailSent && !state.selfJoined;

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
        <p className="text-xs text-secondary">
          Tipp: Wenn du deine eigene Adresse einlädst, wirst du sofort Mitglied — ohne E-Mail.
        </p>
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
            state.emailSent || state.selfJoined
              ? "text-sm text-secondary"
              : "text-sm text-red-400"
          }
          role="status"
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

      <Button type="submit" disabled={pending} className="active:scale-[0.98]">
        {pending ? "Wird gesendet …" : submitLabel ?? "Einladen & E-Mail senden"}
      </Button>
    </form>
  );
}
