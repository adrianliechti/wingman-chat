import { ChevronLeft, ChevronRight } from "lucide-react";

interface WizardNavFooterProps {
  currentStep: number;
  totalSteps: number;
  canNext: boolean;
  isLastStep: boolean;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void;
  isCreating?: boolean;
}

export function WizardNavFooter({
  currentStep,
  totalSteps,
  isLastStep,
  onBack,
  onNext,
  onCreate,
  isCreating,
}: WizardNavFooterProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
      <div>
        {currentStep > 0 && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
          >
            <ChevronLeft size={14} /> Back
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
          {currentStep + 1} / {totalSteps}
        </span>

        {isLastStep ? (
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCreating ? "Creating…" : "Create Agent"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-neutral-700 dark:text-neutral-200 bg-neutral-200/70 dark:bg-neutral-700/70 hover:bg-neutral-300/70 dark:hover:bg-neutral-600/70 transition-colors"
          >
            Next <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
