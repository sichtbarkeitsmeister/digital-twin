"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { SurveyStep } from "@/lib/surveys/types";

type Props = {
  steps: SurveyStep[];
  currentStepIndex: number; // 0-based
  className?: string;
  compactProgress?: number;
  onStepChange?: (index: number) => void;
  missingStepIndices?: number[];
  currentStepMissingRequiredCount?: number;
};

export function SurveyProgress({
  steps,
  currentStepIndex,
  className,
  compactProgress = 0,
  onStepChange,
  missingStepIndices = [],
  currentStepMissingRequiredCount = 0,
}: Props) {
  const total = Math.max(steps.length, 1);
  const safeIndex = Math.min(Math.max(currentStepIndex, 0), total - 1);
  const denom = Math.max(total - 1, 1);
  const progressPct = (safeIndex / denom) * 100;
  const missingSet = new Set(missingStepIndices);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow transition-all duration-200",
        "p-4",
        className,
      )}
    >
      <div className="hidden lg:block">
        <div className="relative">
          <div className="absolute left-0 right-0 top-3 h-2 rounded-full bg-primary/20">
            <motion.div
              className="h-2 rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>

          <div className="relative flex justify-between">
            {steps.map((step, index) => {
              const isCompleted = index < safeIndex;
              const isCurrent = index === safeIndex;
              const isMissing = missingSet.has(index);

              return (
                <div key={step.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => onStepChange?.(index)}
                    disabled={!onStepChange}
                    aria-label={`Zu Schritt ${index + 1} wechseln`}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
                      onStepChange ? "cursor-pointer" : "cursor-default",
                      isCompleted
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-opacity-50"
                        : "border-2 border-border bg-secondary text-secondary-foreground",
                    )}
                  >
                    <span className="text-sm font-bold">
                      {isCompleted ? "✓" : index + 1}
                    </span>
                  </button>
                  {isMissing && !isCompleted ? (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-400 ring-2 ring-card"
                      aria-hidden="true"
                    />
                  ) : null}

                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-lg text-sm text-popover-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10 shadow">
                    <div className="font-semibold">{step.title || `Step ${index + 1}`}</div>
                    {step.description ? (
                      <div className="text-xs text-muted-foreground max-w-[260px] whitespace-normal">
                        {step.description}
                      </div>
                    ) : null}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-popover" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="grid transition-all duration-150 lg:hidden"
        style={{
          rowGap: `${5 - compactProgress * 2}px`,
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ fontSize: `${13 - compactProgress * 1.5}px`, lineHeight: 1.15 }}
        >
          <span className="font-medium">
            Schritt {safeIndex + 1} von {total}
          </span>
          {missingSet.has(safeIndex) ? (
            <span className="text-red-400">
              Pflichtfeld fehlt
              {currentStepMissingRequiredCount > 0 ? ` (${currentStepMissingRequiredCount} offen)` : ""}
            </span>
          ) : null}
        </div>
        <div
          className="rounded-full bg-primary/20 transition-all duration-150"
          style={{ height: `${6 - compactProgress * 3}px` }}
        >
          <div
            className="rounded-full bg-primary transition-[width,height] duration-500 ease-out"
            style={{ height: `${6 - compactProgress * 3}px`, width: `${progressPct}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}

