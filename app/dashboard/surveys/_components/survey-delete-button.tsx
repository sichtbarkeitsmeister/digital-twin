"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

import { deleteSurveyAction } from "@/app/dashboard/surveys/actions";

export function SurveyDeleteButton({ surveyId, title }: { surveyId: string; title: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      disabled={isPending}
      onClick={() => {
        const ok = window.confirm(
          `Umfrage „${title}“ wirklich löschen?\n\nAlle zugehörigen Antworten und Rückfragen werden ebenfalls gelöscht.`,
        );
        if (!ok) return;

        startTransition(async () => {
          const res = await deleteSurveyAction({ surveyId });
          if (!res.ok) {
            window.alert(res.message);
            return;
          }
          router.refresh();
        });
      }}
    >
      {isPending ? "Löschen…" : "Löschen"}
    </Button>
  );
}

