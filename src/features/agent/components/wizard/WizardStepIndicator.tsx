import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";

export interface StepDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface WizardStepIndicatorProps {
  steps: StepDef[];
  currentStep: number;
  visitedSteps: Set<number>;
  onStepClick: (index: number) => void;
}

export function WizardStepIndicator({ steps, currentStep, visitedSteps, onStepClick }: WizardStepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-5 py-3 border-b border-neutral-200/60 dark:border-neutral-800/60">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = visitedSteps.has(i) && i < currentStep;
        const isClickable = visitedSteps.has(i) && i !== currentStep;

        return (
          <div key={step.id} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`w-6 h-px mx-0.5 ${
                  visitedSteps.has(i) ? "bg-neutral-400/60 dark:bg-neutral-500/40" : "bg-neutral-200 dark:bg-neutral-700"
                }`}
              />
            )}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(i)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? "bg-neutral-100 dark:bg-neutral-800/60 text-neutral-900 dark:text-neutral-100"
                  : isCompleted
                    ? "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 cursor-pointer"
                    : "text-neutral-400 dark:text-neutral-500 cursor-default"
              }`}
            >
              {isCompleted ? <Check size={12} /> : <step.icon size={12} />}
              <span className="hidden sm:inline">{step.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
