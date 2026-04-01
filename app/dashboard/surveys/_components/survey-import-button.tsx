"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importSurveyBundleAction } from "@/app/dashboard/surveys/actions";

export function SurveyImportButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;

          startTransition(async () => {
            try {
              const text = await file.text();
              const payload = JSON.parse(text) as unknown;
              const res = await importSurveyBundleAction({ payload });
              if (!res.ok || !res.data?.surveyId) {
                window.alert(res.message);
                return;
              }
              router.push(`/dashboard/surveys/${res.data.surveyId}/edit`);
              router.refresh();
            } catch {
              window.alert("Ungültige JSON-Datei.");
            }
          });
        }}
      />

      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-2 h-4 w-4" />
        Import (inkl. Antworten)
      </Button>
    </>
  );
}

