import { useContext } from "react";
import { ToolsContext } from "@/features/tools/context/ToolsContext";

export function useToolsContext() {
  const context = useContext(ToolsContext);
  if (!context) {
    throw new Error("useToolsContext must be used within a ToolsProvider");
  }
  return context;
}
