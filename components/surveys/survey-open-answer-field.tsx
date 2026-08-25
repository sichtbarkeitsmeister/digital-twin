"use client";

import * as React from "react";

import {
  measureOpenAnswerHeight,
  readOpenAnswerMetrics,
} from "@/lib/surveys/open-answer-field";
import { cn } from "@/lib/utils";

type SurveyOpenAnswerFieldProps = Omit<React.ComponentProps<"textarea">, "rows">;

function applyOpenAnswerSize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.overflowY = "hidden";
  const next = measureOpenAnswerHeight(readOpenAnswerMetrics(el));
  el.style.height = `${next.height}px`;
  el.style.overflowY = next.overflowY;
}

export const SurveyOpenAnswerField = React.forwardRef<
  HTMLTextAreaElement,
  SurveyOpenAnswerFieldProps
>(function SurveyOpenAnswerField({ className, onChange, onInput, value, ...props }, forwardedRef) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const resize = React.useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    applyOpenAnswerSize(el);
  }, []);

  React.useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  React.useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const parent = el.parentElement;
    const observer = new ResizeObserver(() => resize());
    if (parent) observer.observe(parent);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [resize]);

  return (
    <textarea
      {...props}
      ref={setRefs}
      rows={1}
      wrap="soft"
      value={value}
      onChange={(event) => {
        onChange?.(event);
        requestAnimationFrame(resize);
      }}
      onInput={(event) => {
        onInput?.(event);
        requestAnimationFrame(resize);
      }}
      className={cn(
        "flex min-h-11 w-full min-w-0 resize-none overflow-x-hidden whitespace-pre-wrap break-all rounded-md border border-input bg-transparent px-3 py-2 text-base leading-snug shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-9 lg:py-1.5 lg:text-sm max-h-[calc(3lh+1rem)] lg:max-h-[calc(3lh+0.75rem)]",
        className,
      )}
    />
  );
});

SurveyOpenAnswerField.displayName = "SurveyOpenAnswerField";
