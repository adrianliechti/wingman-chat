import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { useChat } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import { Section } from "./Section";

interface ModelSectionProps {
  agent: Agent;
}

export function ModelSection({ agent }: ModelSectionProps) {
  const { updateAgent } = useAgents();
  const { models } = useChat();

  const [isOpen, setIsOpen] = useState(false);
  const [showHiddenModels, setShowHiddenModels] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isRealtimeAgent = agent.model === "realtime";

  // Auto-select first non-hidden model if agent has no model or an invalid one
  useEffect(() => {
    if (isRealtimeAgent) return;
    if (models.length === 0) return;
    const valid = agent.model && models.some((m) => m.id === agent.model);
    if (!valid) {
      const firstVisible = models.find((m) => !m.hidden) ?? models[0];
      updateAgent(agent.id, { model: firstVisible.id });
    }
  }, [isRealtimeAgent, agent.id, agent.model, models, updateAgent]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowHiddenModels(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = (modelId: string) => {
    updateAgent(agent.id, { model: modelId });
    setIsOpen(false);
    setShowHiddenModels(false);
  };

  const effectiveModel =
    agent.model && models.some((m) => m.id === agent.model)
      ? agent.model
      : (models.find((m) => !m.hidden)?.id ?? models[0]?.id ?? "");
  const effectiveModelName = models.find((m) => m.id === effectiveModel)?.name ?? effectiveModel;

  const visibleModels = models.filter((m) => m.id !== "realtime" && !m.hidden);
  const hiddenModels = models.filter((m) => m.id !== "realtime" && m.hidden);

  if (isRealtimeAgent) {
    return (
      <Section title="Model" isOpen={true} collapsible={false}>
        <div className="relative">
          <input
            type="text"
            value="Real-time Voice"
            disabled
            className="w-full rounded-lg bg-neutral-100/60 dark:bg-neutral-800/40 py-2 pl-3 pr-3 text-sm text-neutral-400 dark:text-neutral-500 border border-neutral-200/60 dark:border-neutral-700/60 cursor-not-allowed"
          />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Model" isOpen={true} collapsible={false} overflowVisible>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onPointerDownCapture={(e) => {
            flushSync(() => setShowHiddenModels(e.altKey));
          }}
          onClick={() => setIsOpen((prev) => !prev)}
          className="w-full flex items-center justify-between rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer text-left"
        >
          <span className="truncate">{effectiveModelName}</span>
          <ChevronDown
            size={14}
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 transition-transform",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {isOpen && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 p-1 backdrop-blur-xl shadow-lg">
            {visibleModels.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700/80 ${
                  m.id === effectiveModel
                    ? "font-semibold text-neutral-900 dark:text-neutral-100"
                    : "font-normal text-neutral-800 dark:text-neutral-200"
                }`}
              >
                {m.name ?? m.id}
              </button>
            ))}
            {showHiddenModels && hiddenModels.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 bg-neutral-100/60 dark:bg-white/5 border-y border-neutral-200/60 dark:border-white/10">
                  Hidden
                </div>
                {hiddenModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelect(m.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700/80 ${
                      m.id === effectiveModel
                        ? "font-semibold text-neutral-900 dark:text-neutral-100"
                        : "font-normal text-neutral-800 dark:text-neutral-200"
                    }`}
                  >
                    {m.name ?? m.id}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
