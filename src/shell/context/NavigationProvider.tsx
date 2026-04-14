import type { ReactNode } from "react";
import { useState } from "react";
import type { NavigationContextType } from "./NavigationContext";
import { NavigationContext } from "./NavigationContext";

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [leftActions, setLeftActions] = useState<ReactNode>(null);
  const [rightActions, setRightActions] = useState<ReactNode>(null);

  const value: NavigationContextType = {
    leftActions,
    setLeftActions,
    rightActions,
    setRightActions,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
