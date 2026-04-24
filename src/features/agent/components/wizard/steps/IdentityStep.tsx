import { type Dispatch, useId } from "react";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface IdentityStepProps {
  instructions: string;
  dispatch: Dispatch<WizardAction>;
}

export function IdentityStep({ instructions, dispatch }: IdentityStepProps) {
  const instructionsInputId = useId();

  return (
    <div className="space-y-4">
      <StepHeader
        title="Define your agent's identity"
        description="Shape your agent's behavior with instructions — think of them as the agent's soul. This is optional and can be updated anytime."
      />

      <div>
        <label
          htmlFor={instructionsInputId}
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
        >
          Instructions
        </label>
        <textarea
          id={instructionsInputId}
          value={instructions}
          onChange={(e) => dispatch({ type: "SET_INSTRUCTIONS", value: e.target.value })}
          rows={8}
          placeholder="How should this agent behave? What personality, constraints, or context should it have?"
          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors resize-y"
        />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          The soul of your agent — the instructions it follows in every conversation.
        </p>
      </div>
    </div>
  );
}
