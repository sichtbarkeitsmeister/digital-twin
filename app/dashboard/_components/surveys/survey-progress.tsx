"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { SurveyStep } from "@/lib/surveys/types";

type Props = {
  steps: SurveyStep[];
  currentStepIndex: number; // 0-based
  className?: string;
};

export function SurveyProgress({ steps, currentStepIndex, className }: Props) {
  const total = Math.max(steps.length, 1);
  const safeIndex = Math.min(Math.max(currentStepIndex, 0), total - 1);
  const denom = Math.max(total - 1, 1);
  const progressPct = (safeIndex / denom) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-xl border bg-card text-card-foreground shadow p-4", className)}
    >
      <div className="relative">
        <div className="absolute top-3 left-0 right-0 h-2 bg-primary/20 rounded-full">
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

            return (
              <div key={step.id} className="relative group">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200",
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isCurrent
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-opacity-50"
                        : "bg-secondary border-2 border-border text-secondary-foreground",
                  )}
                >
                  <span className="text-sm font-bold">
                    {isCompleted ? "✓" : index + 1}
                  </span>
                </div>

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
    </motion.div>
  );
}

