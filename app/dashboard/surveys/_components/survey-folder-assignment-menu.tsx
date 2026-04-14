"use client";

import { useTransition } from "react";
import { Check, FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";

import { assignSurveyFolderAction } from "@/app/dashboard/surveys/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FolderItem = { id: string; name: string };

export function SurveyFolderAssignmentMenu(props: {
  surveyId: string;
  currentFolderId: string | null;
  folders: FolderItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const currentLabel =
    props.currentFolderId === null
      ? "Ohne Ordner"
      : (props.folders.find((f) => f.id === props.currentFolderId)?.name ?? "Ordner");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={isPending}>
          <FolderOpen className="h-3.5 w-3.5" />
          {currentLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await assignSurveyFolderAction({ surveyId: props.surveyId, folderId: null });
              if (!res.ok) {
                window.alert(res.message);
                return;
              }
              router.refresh();
            });
          }}
        >
          <span className="inline-flex items-center gap-2">
            {props.currentFolderId === null ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
            Ohne Ordner
          </span>
        </DropdownMenuItem>
        {props.folders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onSelect={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await assignSurveyFolderAction({
                  surveyId: props.surveyId,
                  folderId: folder.id,
                });
                if (!res.ok) {
                  window.alert(res.message);
                  return;
                }
                router.refresh();
              });
            }}
          >
            <span className="inline-flex items-center gap-2">
              {props.currentFolderId === folder.id ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
              {folder.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
