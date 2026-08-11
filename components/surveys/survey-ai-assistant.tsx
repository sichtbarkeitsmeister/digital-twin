"use client";

import { useMemo, useState } from "react";
import { Bot, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SurveyAiChatShell } from "@/components/surveys/survey-ai-chat-shell";

type PageContext = {
  page:
    | "survey_list"
    | "survey_builder_new"
    | "survey_builder_edit"
    | "dt_agents"
    | "survey_to_agent";
  surveyId: string | null;
  visibility?: "private" | "public";
  slug?: string | null;
  notificationEmails?: string[];
  organisationId?: string | null;
  agentId?: string | null;
};

type Props<TContext extends PageContext> = {
  title?: string;
  buildContext: () => TContext;
  getContextSummary?: (context: TContext) => string;
};

export function SurveyAiAssistant<TContext extends PageContext>({
  title = "KI-Assistent",
  buildContext,
}: Props<TContext>) {
  const [open, setOpen] = useState(false);
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const context = useMemo(() => buildContext(), [buildContext]);

  return (
    <div className="fixed bottom-4 right-4 z-[130] flex max-w-[calc(100vw-1rem)] flex-col items-end gap-2">
      {hasOpenedOnce ? (
        <Card
          className={`flex h-[min(86vh,calc(100dvh-5.5rem))] w-[min(1220px,calc(100vw-1rem))] max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden shadow-xl ${
            open ? "" : "hidden"
          }`}
          onWheelCapture={(e) => {
            e.stopPropagation();
          }}
        >
          <CardHeader className="shrink-0 space-y-0 p-4 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                {title}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Schließen"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="relative min-h-0 flex-1 overflow-hidden p-0">
            <div className="absolute inset-x-3 bottom-3 top-0 min-h-0">
              <SurveyAiChatShell pageContext={context} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Button
        type="button"
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) setHasOpenedOnce(true);
            return next;
          });
        }}
        aria-label={open ? "KI-Assistent schließen" : "KI-Assistent öffnen"}
      >
        <Bot className="h-5 w-5" />
      </Button>
    </div>
  );
}
