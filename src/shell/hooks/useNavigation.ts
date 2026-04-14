import { useContext } from "react";
import type { NavigationContextType } from "@/shell/context/NavigationContext";
import { NavigationContext } from "@/shell/context/NavigationContext";

export function useNavigation(): NavigationContextType {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error("useNavigation must be used within a NavigationProvider");
  }
  return context;
}
