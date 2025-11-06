import { useContext } from "react";
import { InterpreterContext } from "../contexts/InterpreterContext";
import type { InterpreterContextType } from "../contexts/InterpreterContext";

export function useInterpreter(): InterpreterContextType {
  const context = useContext(InterpreterContext);
  if (context === undefined) {
    throw new Error('useInterpreter must be used within an InterpreterProvider');
  }
  return context;
}
