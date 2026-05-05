"use client";

import { useState, useTransition } from "react";
import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { deleteSurveyFolderAction } from "@/app/dashboard/surveys/actions";
import { Button } from "@/components/ui/button";

type Props = {
  folderId: string;
  folderName: string;
};

export function DeleteSurveyFolderButton({ folderId, folderName }: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-secondary hover:text-red-400"
        aria-label={`Ordner löschen: ${folderName}`}
        onClick={() => setIsOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Ordner löschen</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-sm text-secondary">
              Ordner <span className="font-medium text-primary">„{folderName}“</span> löschen?
              Zugeordnete Umfragen bleiben erhalten und werden automatisch aus dem Ordner entfernt.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await deleteSurveyFolderAction({ folderId });
                    if (!res.ok) {
                      window.alert(res.message);
                      return;
                    }
                    setIsOpen(false);
                    router.refresh();
                  });
                }}
              >
                Löschen
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

