"use client";

export function DtChatThinking() {
  return (
    <div
      className="flex max-w-[92%] items-center gap-3 py-1 text-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="animate-ai-thinking-ring h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 leading-snug text-sbkm-ink-600 dark:text-white/60">
        <span className="animate-ai-thinking-shimmer inline-block max-w-full align-middle">
          DigitalTwin denkt nach …
        </span>
      </p>
    </div>
  );
}
