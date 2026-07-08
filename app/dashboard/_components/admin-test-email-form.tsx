"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  sendTestEmailAction,
  type MailActionState,
} from "@/app/dashboard/admin/mails/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const initialState: MailActionState = { ok: true, message: "" };

export function AdminTestEmailForm() {
  const [state, formAction, pending] = useActionState(sendTestEmailAction, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="recipient_email">Empfänger</Label>
        <Input
          id="recipient_email"
          name="recipient_email"
          type="email"
          placeholder="name@firma.de"
          autoComplete="email"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="subject">Betreff (optional)</Label>
        <Input
          id="subject"
          name="subject"
          placeholder="SBKM Test-E-Mail"
          autoComplete="off"
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Sende…
          </>
        ) : (
          "Test-E-Mail senden"
        )}
      </Button>

      {state.message ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
            state.ok
              ? "border-emerald-200/80 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}
        >
          {state.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : null}
          <span>{state.message}</span>
        </div>
      ) : null}
    </form>
  );
}
