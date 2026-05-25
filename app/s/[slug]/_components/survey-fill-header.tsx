"use client";

import { Info } from "lucide-react";

import { DtEyebrow, DtGlassCard, DtPillButton } from "@/components/dt";
import { SurveyProgress } from "@/app/dashboard/_components/surveys/survey-progress";
import { cn } from "@/lib/utils";
import type { SurveyStep } from "@/lib/surveys/types";

type SurveyFillHeaderProps = {
  title: string;
  steps: SurveyStep[];
  stepIndex: number;
  canBack: boolean;
  canNext: boolean;
  showInfoButton: boolean;
  missingRequiredInCurrentStep: number;
  missingRequiredStepIndices: number[];
  mobileCompactProgress: number;
  isLoading: boolean;
  errorMessage?: string;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onInfoOpen: () => void;
  onStepChange: (index: number) => void;
};

export function SurveyFillHeader({
  title,
  steps,
  stepIndex,
  canBack,
  canNext,
  showInfoButton,
  missingRequiredInCurrentStep,
  missingRequiredStepIndices,
  mobileCompactProgress,
  isLoading,
  errorMessage,
  onBack,
  onNext,
  onSubmit,
  onInfoOpen,
  onStepChange,
}: SurveyFillHeaderProps) {
  return (
    <div className="sticky top-3 z-40 sm:top-4">
      <DtGlassCard
        padding="sm"
        className={cn(
          "border-sbkm-navy/10 shadow-dt-lg",
          "pb-3 pt-3 sm:pb-4 sm:pt-4",
        )}
      >
        <div
          className="grid transition-all duration-150 ease-out"
          style={{ rowGap: `${14 - mobileCompactProgress * 4}px` }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <DtEyebrow>Umfrage</DtEyebrow>
              <h1
                className="text-base font-bold leading-snug tracking-[-0.01em] text-sbkm-navy transition-all duration-150 dark:text-white sm:text-lg"
                style={{ fontSize: `${16 - mobileCompactProgress * 1.5}px` }}
              >
                {title || "Umfrage"}
              </h1>
            </div>

            {missingRequiredInCurrentStep > 0 ? (
              <span className="inline-flex w-fit shrink-0 items-center rounded-pill bg-red-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-red-600 ring-1 ring-red-500/20 dark:bg-red-500/15 dark:text-red-300">
                {missingRequiredInCurrentStep} Pflichtfeld(er) offen
              </span>
            ) : null}
          </div>

          {errorMessage ? (
            <p className="rounded-[10px] bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {errorMessage}
            </p>
          ) : null}

          <SurveyProgress
            variant="embedded"
            steps={steps}
            currentStepIndex={stepIndex}
            compactProgress={mobileCompactProgress}
            onStepChange={onStepChange}
            missingStepIndices={missingRequiredStepIndices}
            currentStepMissingRequiredCount={missingRequiredInCurrentStep}
          />

          <div className="flex items-center gap-2 border-t border-sbkm-navy/[0.08] pt-3 dark:border-white/10">
            <DtPillButton
              type="button"
              variant="outline"
              size="sm"
              disabled={!canBack}
              onClick={onBack}
              className="min-w-[96px] flex-1 sm:flex-none"
            >
              Zurück
            </DtPillButton>

            {showInfoButton ? (
              <button
                type="button"
                onClick={onInfoOpen}
                aria-label="Fragebogen-Information anzeigen"
                className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-pill border border-sbkm-navy/15 bg-white text-sbkm-ink-600 transition-colors hover:border-sbkm-navy hover:text-sbkm-navy dark:border-white/15 dark:bg-white/10 dark:text-white/70 dark:hover:border-sbkm-mint dark:hover:text-white"
              >
                <Info className="h-4 w-4" strokeWidth={1.8} />
              </button>
            ) : (
              <span className="hidden w-9 sm:block" aria-hidden="true" />
            )}

            <DtPillButton
              type="button"
              size="sm"
              disabled={isLoading}
              onClick={canNext ? onNext : onSubmit}
              className="min-w-[96px] flex-1 sm:ml-auto sm:flex-none"
            >
              {canNext ? "Weiter" : "Senden"}
            </DtPillButton>
          </div>
        </div>
      </DtGlassCard>
    </div>
  );
}
