import { useContext } from "react";
import { ReplContext } from "../contexts/ReplContext";
import type { ReplContextType } from "../contexts/ReplContext";

export function useRepl(): ReplContextType {
  const context = useContext(ReplContext);
  if (context === undefined) {
    throw new Error('useRepl must be used within a ReplProvider');
  }
  return context;
}
