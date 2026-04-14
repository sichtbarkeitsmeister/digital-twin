"use client";

import { useState, useTransition } from "react";
import { FolderPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { createSurveyFolderAction } from "@/app/dashboard/surveys/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateSurveyFolderButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
        <FolderPlus className="mr-2 h-4 w-4" />
        Ordner erstellen
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Neuen Ordner erstellen</h2>
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

            <div className="grid gap-3">
              <Input
                value={name}
                disabled={isPending}
                placeholder="z.B. Recruiting 2026"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const nextName = name.trim();
                  if (!nextName) return;
                  startTransition(async () => {
                    const res = await createSurveyFolderAction({ name: nextName });
                    if (!res.ok) {
                      window.alert(res.message);
                      return;
                    }
                    setName("");
                    setIsOpen(false);
                    router.refresh();
                  });
                }}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  disabled={isPending || !name.trim()}
                  onClick={() => {
                    const nextName = name.trim();
                    if (!nextName) return;
                    startTransition(async () => {
                      const res = await createSurveyFolderAction({ name: nextName });
                      if (!res.ok) {
                        window.alert(res.message);
                        return;
                      }
                      setName("");
                      setIsOpen(false);
                      router.refresh();
                    });
                  }}
                >
                  Erstellen
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
