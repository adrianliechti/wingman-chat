import { Bot } from "lucide-react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { cn } from "@/shared/lib/cn";

export function AgentButton() {
  const { currentAgent, showAgentDrawer, setShowAgentDrawer, setAgentDrawerView } = useAgents();

  function handleClick() {
    if (showAgentDrawer) {
      setShowAgentDrawer(false);
      return;
    }
    // Open the agent's details when one is active, otherwise the list to
    // select/create/manage agents (the same view as "Manage Agents" in the "+" menu).
    setAgentDrawerView(currentAgent ? "details" : "list");
    setShowAgentDrawer(true);
  }

  return (
    <button
      type="button"
      aria-label={showAgentDrawer ? "Close agent" : currentAgent ? "Open agent" : "Manage agents"}
      aria-expanded={showAgentDrawer}
      title={showAgentDrawer ? "Close agent" : currentAgent ? currentAgent.name : "Manage agents"}
      className={cn(
        "p-2 rounded-full transition-all duration-150 ease-out",
        showAgentDrawer
          ? "text-neutral-900 dark:text-neutral-100 bg-neutral-200 dark:bg-neutral-700/60"
          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
      )}
      onClick={handleClick}
    >
      <Bot size={20} />
    </button>
  );
}
