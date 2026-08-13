"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { adminArchiveOrganisationAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Platform-admin soft-delete with two confirmations:
 * 1) explicit intent dialog
 * 2) type the organisation name
 */
export function DeleteOrganisationButton(props: {
  organisationId: string;
  organisationName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function requestDelete() {
    setError(null);
    const ok = window.confirm(
      `Organisation „${props.organisationName}“ wirklich löschen?\n\n` +
        `Sie verschwindet aus der Übersicht. Zugehörige Daten bleiben technisch erhalten (Archiv).`,
    );
    if (!ok) return;
    setConfirmName("");
    setOpen(true);
  }

  function submitDelete() {
    setError(null);
    startTransition(async () => {
      const res = await adminArchiveOrganisationAction({
        organisationId: props.organisationId,
        confirmName,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.push("/dashboard/admin/organisations");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
        onClick={requestDelete}
      >
        <Trash2 className="size-3.5" aria-hidden />
        Organisation löschen
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-4 shadow-xl">
            <h2 className="text-base font-semibold tracking-tight">Löschen bestätigen</h2>
            <p className="mt-2 text-sm text-secondary">
              Zweite Bestätigung: Tippe den Organisationsnamen{" "}
              <strong className="font-semibold text-foreground">
                {props.organisationName}
              </strong>{" "}
              genau ein.
            </p>
            <div className="mt-3 grid gap-2">
              <Label htmlFor="confirm-org-name">Organisationsname</Label>
              <Input
                id="confirm-org-name"
                value={confirmName}
                autoFocus
                disabled={isPending}
                placeholder={props.organisationName}
                onChange={(e) => setConfirmName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitDelete();
                  }
                }}
              />
            </div>
            {error ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isPending || !confirmName.trim()}
                onClick={submitDelete}
              >
                {isPending ? "Löschen…" : "Endgültig löschen"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
