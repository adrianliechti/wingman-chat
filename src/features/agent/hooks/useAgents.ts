import { useContext } from "react";
import { AgentContext } from "@/features/agent/context/AgentContext";

export function useAgents() {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error("useAgents must be used within an AgentProvider");
  }
  return context;
}
