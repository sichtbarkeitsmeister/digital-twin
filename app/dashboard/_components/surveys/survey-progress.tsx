"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { SurveyStep } from "@/lib/surveys/types";

type Props = {
  steps: SurveyStep[];
  currentStepIndex: number;
  className?: string;
  compactProgress?: number;
  onStepChange?: (index: number) => void;
  missingStepIndices?: number[];
  currentStepMissingRequiredCount?: number;
  variant?: "card" | "embedded";
};

function stepperScale(total: number) {
  if (total > 10) {
    return {
      circle: "h-6 w-6 text-[10px]",
      row: "h-6",
      check: "h-3 w-3",
      dot: "right-[calc(50%-14px)] -top-0.5 h-1.5 w-1.5",
    };
  }
  if (total > 6) {
    return {
      circle: "h-[26px] w-[26px] text-[11px]",
      row: "h-[26px]",
      check: "h-3 w-3",
      dot: "right-[calc(50%-16px)] -top-0.5 h-1.5 w-1.5",
    };
  }
  return {
    circle: "h-7 w-7 text-xs",
    row: "h-7",
    check: "h-3.5 w-3.5",
    dot: "right-[calc(50%-18px)] -top-0.5 h-2 w-2",
  };
}

export function SurveyProgress({
  steps,
  currentStepIndex,
  className,
  compactProgress = 0,
  onStepChange,
  missingStepIndices = [],
  currentStepMissingRequiredCount = 0,
  variant = "card",
}: Props) {
  const total = Math.max(steps.length, 1);
  const safeIndex = Math.min(Math.max(currentStepIndex, 0), total - 1);
  const denom = Math.max(total - 1, 1);
  const progressPct = (safeIndex / denom) * 100;
  const missingSet = new Set(missingStepIndices);
  const scale = stepperScale(total);
  const trackInset = `calc(100% / ${total} / 2)`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        variant === "card" &&
          "rounded-dt border border-sbkm-navy/10 bg-white/50 p-4 shadow-dt backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]",
        variant === "embedded" && "min-w-0",
        className,
      )}
    >
      {/* Desktop / tablet: equal-width stepper, no scroll */}
      <div className="hidden min-w-0 sm:block">
        <div className={cn("relative w-full", scale.row)}>
          {/* Track sits behind circles, vertically centered on the row */}
          <div
            className="absolute top-1/2 z-0 h-0.5 -translate-y-1/2 rounded-full bg-sbkm-navy/10 dark:bg-white/10"
            style={{ left: trackInset, right: trackInset }}
          />
          <motion.div
            className="absolute top-1/2 z-0 h-0.5 -translate-y-1/2 rounded-full bg-sbkm-mint"
            initial={{ width: 0 }}
            animate={{
              width: total <= 1 ? "0%" : `calc((100% - 100% / ${total}) * ${progressPct / 100})`,
            }}
            style={{ left: trackInset }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />

          <div
            className="relative z-10 grid h-full w-full items-center"
            style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
          >
            {steps.map((step, index) => {
              const isCompleted = index < safeIndex;
              const isCurrent = index === safeIndex;
              const isMissing = missingSet.has(index);
              const isUpcoming = !isCompleted && !isCurrent;

              return (
                <div key={step.id} className="group relative flex justify-center">
                  <button
                    type="button"
                    onClick={() => onStepChange?.(index)}
                    disabled={!onStepChange}
                    aria-label={`Zu Schritt ${index + 1} wechseln${step.title ? `: ${step.title}` : ""}`}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "relative z-[1] flex shrink-0 items-center justify-center rounded-full font-bold transition-all duration-200 ease-out",
                      scale.circle,
                      onStepChange ? "cursor-pointer hover:scale-105" : "cursor-default",
                      isCompleted &&
                        "bg-sbkm-mint text-sbkm-navy shadow-[0_0_0_2px_rgba(100,253,194,0.35)]",
                      isCurrent &&
                        !isCompleted &&
                        "bg-sbkm-navy text-white shadow-dt-focus ring-2 ring-sbkm-mint/40 dark:bg-sbkm-mint dark:text-sbkm-navy dark:ring-sbkm-navy/30",
                      isUpcoming &&
                        "border border-sbkm-navy/15 bg-white text-sbkm-ink-600 dark:border-white/20 dark:bg-sbkm-ink-800 dark:text-white/80",
                    )}
                  >
                    {isCompleted ? (
                      <Check className={scale.check} strokeWidth={2.5} />
                    ) : (
                      index + 1
                    )}
                  </button>

                  {isMissing && !isCompleted ? (
                    <span
                      className={cn(
                        "absolute z-[2] rounded-full bg-red-500 ring-2 ring-white dark:ring-sbkm-ink-800",
                        scale.dot,
                      )}
                      aria-hidden="true"
                    />
                  ) : null}

                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-[10px] border border-sbkm-navy/10 bg-white px-3 py-2 text-xs text-sbkm-navy opacity-0 shadow-dt transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-white/10 dark:bg-sbkm-ink-900 dark:text-white">
                    <div className="font-bold">{step.title || `Schritt ${index + 1}`}</div>
                    {step.description ? (
                      <div className="mt-0.5 text-sbkm-ink-600 dark:text-white/70">{step.description}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mobile: compact bar */}
      <div
        className="grid transition-all duration-150 sm:hidden"
        style={{ rowGap: `${5 - compactProgress * 2}px` }}
      >
        <div
          className="flex items-center justify-between gap-3 text-sbkm-navy dark:text-white"
          style={{ fontSize: `${13 - compactProgress * 1.5}px`, lineHeight: 1.15 }}
        >
          <span className="font-bold">
            Schritt {safeIndex + 1}{" "}
            <span className="font-normal text-sbkm-ink-500">von {total}</span>
          </span>
          {missingSet.has(safeIndex) ? (
            <span className="text-xs font-medium text-red-500">
              {currentStepMissingRequiredCount > 0
                ? `${currentStepMissingRequiredCount} Pflichtfeld(er) offen`
                : "Pflichtfeld fehlt"}
            </span>
          ) : null}
        </div>
        <div
          className="overflow-hidden rounded-pill bg-sbkm-navy/10 transition-all duration-150 dark:bg-white/10"
          style={{ height: `${6 - compactProgress * 2}px` }}
        >
          <div
            className="h-full rounded-pill bg-sbkm-mint transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(progressPct, safeIndex === 0 ? 8 : progressPct)}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}
