import type { Dispatch } from "react";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface IdentityStepProps {
  name: string;
  description: string;
  instructions: string;
  showValidation: boolean;
  dispatch: Dispatch<WizardAction>;
}

export function IdentityStep({ name, description, instructions, showValidation, dispatch }: IdentityStepProps) {
  const nameError = showValidation && !name.trim() ? "Name is required" : "";

  return (
    <div className="space-y-4">
      <StepHeader
        title="Define your agent's identity"
        description="An agent is a reusable AI persona with its own instructions, skills, and tools. Start by giving it a name, then shape its behavior with instructions — think of them as the agent's soul. Only the name is required; everything else can be added later."
      />

      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
          Name <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
          autoFocus
          placeholder="My Agent"
          className={`w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border ${
            nameError
              ? "border-red-400/70 dark:border-red-500/70 focus:ring-red-500/60"
              : "border-neutral-300/60 dark:border-neutral-700/60 focus:ring-neutral-500/60"
          } focus:ring-2 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors`}
        />
        {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => dispatch({ type: "SET_DESCRIPTION", value: e.target.value })}
          placeholder="A one-liner about what this agent does"
          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">Instructions</label>
        <textarea
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
