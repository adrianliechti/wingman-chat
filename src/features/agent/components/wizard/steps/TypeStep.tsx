import { Bot, Check, Mic } from "lucide-react";
import { type Dispatch, useId } from "react";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface TypeStepProps {
  agentType: "model" | "realtime";
  name: string;
  showValidation: boolean;
  dispatch: Dispatch<WizardAction>;
}

const agentTypes = [
  {
    value: "model" as const,
    icon: Bot,
    label: "AI Model",
    description: "Text-based chat with skills, tools and knowledge",
  },
  {
    value: "realtime" as const,
    icon: Mic,
    label: "Real-time Voice",
    description: "Low-latency voice conversation with real-time AI",
  },
];

export function TypeStep({ agentType, name, showValidation, dispatch }: TypeStepProps) {
  const nameInputId = useId();
  const nameError = showValidation && !name.trim() ? "Name is required" : "";

  return (
    <div className="space-y-4">
      <StepHeader
        title="Create a new agent"
        description="Give your agent a name and choose how it will interact. AI Model agents support skills, tools, and knowledge. Real-time Voice agents use low-latency voice conversation."
      />

      {/* Name */}
      <div>
        <label
          htmlFor={nameInputId}
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
        >
          Name <span className="text-red-400">*</span>
        </label>
        <input
          id={nameInputId}
          type="text"
          value={name}
          onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
          placeholder="My Agent"
          className={`w-full px-3 py-2.5 text-sm rounded-lg bg-white dark:bg-neutral-800/60 border ${
            nameError
              ? "border-red-400/70 dark:border-red-500/70 focus:ring-red-500/40"
              : "border-neutral-200 dark:border-neutral-700/70 focus:ring-neutral-400/40 dark:focus:ring-neutral-500/40"
          } focus:outline-none focus:ring-2 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 transition-colors`}
        />
        {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
      </div>

      {/* Type */}
      <div>
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          Type
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {agentTypes.map(({ value, icon: Icon, label, description }) => {
            const isSelected = agentType === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => dispatch({ type: "SET_AGENT_TYPE", value })}
                className={`relative flex flex-col gap-2.5 p-4 rounded-xl border-2 text-left transition-all ${
                  isSelected
                    ? "border-neutral-900 dark:border-neutral-200 bg-neutral-50 dark:bg-neutral-800/60"
                    : "border-neutral-200/70 dark:border-neutral-700/60 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-800/20"
                }`}
              >
                {isSelected && (
                  <span className="absolute top-2.5 right-2.5 flex items-center justify-center w-4 h-4 rounded-full bg-neutral-900 dark:bg-neutral-100">
                    <Check size={9} className="text-white dark:text-neutral-900" />
                  </span>
                )}
                <div
                  className={`flex items-center justify-center w-9 h-9 rounded-lg ${
                    isSelected
                      ? "bg-neutral-900 dark:bg-neutral-100"
                      : "bg-neutral-100 dark:bg-neutral-700/60"
                  }`}
                >
                  <Icon
                    size={18}
                    className={
                      isSelected
                        ? "text-white dark:text-neutral-900"
                        : "text-neutral-500 dark:text-neutral-300"
                    }
                  />
                </div>
                <div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 leading-tight">
                    {label}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
                    {description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
