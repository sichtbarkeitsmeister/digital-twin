"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function RevokeInviteButton({
  inviteId,
  organisationId,
}: {
  inviteId: string;
  organisationId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        "Einladung wirklich löschen? Danach kannst du die Person erneut einladen.",
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/org-invites/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, organisationId }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;

      if (!res.ok || !json?.ok) {
        setError(json?.message ?? `Löschen fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler beim Löschen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-xs flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => void handleDelete()}
        className="transition-transform duration-150 active:scale-[0.98]"
      >
        {pending ? "Löschen…" : "Löschen"}
      </Button>
      {error ? (
        <span className="text-right text-xs text-red-400" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
