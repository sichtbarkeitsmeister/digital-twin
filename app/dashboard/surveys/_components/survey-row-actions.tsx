"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Download, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  deleteSurveyAction,
  exportSurveyBundleAction,
  publishSurveyAction,
  unpublishSurveyAction,
} from "@/app/dashboard/surveys/actions";

export function SurveyRowActions(props: {
  surveyId: string;
  title: string;
  editHref: string;
  responseHref: string;
  isPublic: boolean;
  pendingCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function safeFilename(input: string) {
    return (
      input
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || "survey"
    );
  }

  function downloadJson(filename: string, content: string) {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" disabled={isPending} aria-label="Aktionen">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={props.editHref}>Bearbeiten</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={props.responseHref} className="inline-flex items-center justify-between gap-2">
            Antworten
            {props.pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-secondary">
                <span className="h-2 w-2 rounded-full bg-red-500" aria-label="Neue Frage" />
                {props.pendingCount}
              </span>
            ) : null}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {props.isPublic ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await unpublishSurveyAction({ surveyId: props.surveyId });
                if (!res.ok) {
                  window.alert(res.message);
                  return;
                }
                router.refresh();
              });
            }}
          >
            Privat machen
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await publishSurveyAction({ surveyId: props.surveyId });
                if (!res.ok) {
                  window.alert(res.message);
                  return;
                }
                router.refresh();
              });
            }}
          >
            Veröffentlichen
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await exportSurveyBundleAction({ surveyId: props.surveyId });
              if (!res.ok || !res.data) {
                window.alert(res.message);
                return;
              }
              const filename = `${safeFilename(props.title)}-with-answers.json`;
              downloadJson(filename, JSON.stringify(res.data, null, 2));
            });
          }}
        >
          <Download className="h-4 w-4" />
          Export (inkl. Antworten)
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={(e) => {
            e.preventDefault();
            const ok = window.confirm(
              `Umfrage „${props.title}“ wirklich löschen?\n\nAlle zugehörigen Antworten und Rückfragen werden ebenfalls gelöscht.`,
            );
            if (!ok) return;

            startTransition(async () => {
              const res = await deleteSurveyAction({ surveyId: props.surveyId });
              if (!res.ok) {
                window.alert(res.message);
                return;
              }
              router.refresh();
            });
          }}
        >
          Löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

