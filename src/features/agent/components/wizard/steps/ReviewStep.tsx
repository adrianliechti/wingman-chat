import type { Dispatch } from "react";
import { ChevronDown, ToggleLeft, ToggleRight, Zap, Wrench, FileText, Server } from "lucide-react";
import { useChat } from "@/features/chat/hooks/useChat";
import { getConfig } from "@/shared/config";
import type { BridgeServer } from "@/features/agent/types/agent";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface ReviewStepProps {
  name: string;
  description: string;
  instructions: string;
  selectedSkills: string[];
  selectedTools: string[];
  servers: Omit<BridgeServer, "id">[];
  pendingFiles: File[];
  model: string;
  memory: boolean;
  dispatch: Dispatch<WizardAction>;
}

export function ReviewStep({
  name,
  description,
  instructions,
  selectedSkills,
  selectedTools,
  servers,
  pendingFiles,
  model,
  memory,
  dispatch,
}: ReviewStepProps) {
  const { models } = useChat();
  const config = getConfig();

  return (
    <div className="space-y-4">
      <StepHeader
        title="Review & create"
        description="Almost there! Choose which model powers your agent, review your setup, and hit create. Nothing is permanent — you can tweak everything from the agent drawer anytime."
      />

      {/* Model */}
      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">Model</label>
        <div className="relative">
          <select
            value={model || models[0]?.id || ""}
            onChange={(e) => dispatch({ type: "SET_MODEL", id: e.target.value })}
            className="w-full appearance-none rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.id}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/30 dark:bg-neutral-900/20 divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
        {/* Identity */}
        <div className="px-3 py-2.5">
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{name}</div>
          {description && <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{description}</div>}
          {instructions && (
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1 line-clamp-2">{instructions}</div>
          )}
        </div>

        {/* Skills */}
        {selectedSkills.length > 0 && (
          <div className="px-3 py-2.5">
            <div className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">
              Skills
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedSkills.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-neutral-100 dark:bg-neutral-800/40 text-neutral-700 dark:text-neutral-300"
                >
                  <Zap size={8} /> {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tools */}
        {(selectedTools.length > 0 || servers.length > 0) && (
          <div className="px-3 py-2.5">
            <div className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">
              Tools
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedTools.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                >
                  <Wrench size={8} /> {t}
                </span>
              ))}
              {servers.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                >
                  <Server size={8} /> {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Files */}
        {pendingFiles.length > 0 && (
          <div className="px-3 py-2.5">
            <div className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">
              Files
            </div>
            <div className="flex flex-wrap gap-1">
              {pendingFiles.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                >
                  <FileText size={8} /> {f.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Memory toggle */}
      {config.memory && (
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Memory</div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
              Remember context across conversations
            </div>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: "SET_MEMORY", enabled: !memory })}
            className={`shrink-0 ${memory ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
          >
            {memory ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          </button>
        </div>
      )}
    </div>
  );
}
