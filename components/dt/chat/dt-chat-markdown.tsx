"use client";

import { SurveyChatMarkdown } from "@/components/surveys/survey-chat-markdown";
import { cn } from "@/components/dt/cn";

export function DtChatMarkdown(props: { content: string; className?: string }) {
  return (
    <SurveyChatMarkdown
      content={props.content}
      className={cn(
        "text-sbkm-navy dark:text-white/90",
        "[&_table]:border-sbkm-navy/15 [&_thead]:bg-sbkm-navy/[0.06] dark:[&_table]:border-white/15 dark:[&_thead]:bg-white/[0.08]",
        "[&_th]:text-sbkm-ink-600 dark:[&_th]:text-white/60",
        "[&_td]:text-sbkm-navy dark:[&_td]:text-white/85",
        "[&_tr:nth-child(even)]:bg-sbkm-navy/[0.03] dark:[&_tr:nth-child(even)]:bg-white/[0.04]",
        props.className,
      )}
    />
  );
}
