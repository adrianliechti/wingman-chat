import { useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { ReplContext } from "./ReplContext";
import type { ReplContextType } from "./ReplContext";
import type { Tool } from "../types/chat";
import { getConfig } from "../config";
import { executeCode } from "../lib/repl";

interface ReplProviderProps {
  children: ReactNode;
}

export function ReplProvider({ children }: ReplProviderProps) {
  const [isEnabled, setEnabled] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  // Check REPL availability from config
  useEffect(() => {
    try {
      const config = getConfig();
      setIsAvailable(config.repl.enabled);
    } catch (error) {
      console.warn('Failed to get REPL config:', error);
      setIsAvailable(false);
    }
  }, []);

  const replTools = useCallback((): Tool[] => {
    if (!isEnabled) {
      return [];
    }

    return [
      {
        name: "execute_python_code",
        description: "Execute Python code with optional package dependencies. Use this to perform calculations, data analysis, create visualizations, or run any Python script.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The Python code to execute. Can include imports, functions, calculations, and print statements."
            },
            packages: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Optional list of Python packages required for the code (e.g., ['numpy', 'pandas', 'matplotlib']). These will be available for import in the code."
            }
          },
          required: ["code"]
        },
        function: async (args: Record<string, unknown>) => {
          const { code, packages } = args;
          
          console.log("[execute_python_code] Starting execution", { 
            codeLength: (code as string)?.length,
            packages 
          });
          
          try {
            const result = await executeCode({
              code: code as string,
              packages: packages as string[] | undefined
            });
            
            console.log("[execute_python_code] Execution completed", { 
              success: result.success,
              outputLength: result.output.length 
            });
            
            if (!result.success) {
              return `Error executing code: ${result.error || 'Unknown error'}`;
            }

            return result.output;
          } catch (error) {
            console.error("[execute_python_code] Execution failed", { 
              error: error instanceof Error ? error.message : error 
            });
            return `Code execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        }
      }
    ];
  }, [isEnabled]);

  const replInstructions = useCallback((): string => {
    if (!isEnabled) {
      return "";
    }

    return `
      You have access to a Python REPL.
      
      - Use the execute_python_code tool when you need to perform calculations, data analysis, create visualizations, or run Python scripts.
      - You can specify required packages in the packages parameter (e.g., ['numpy', 'pandas', 'matplotlib']).
      - The code will be executed in a sandboxed environment and you'll receive the output.
      - Use this for complex mathematical operations, data transformations, plotting graphs, or any computational tasks.
      
      Always use the Python REPL when the user asks for calculations, data analysis, or visualization tasks.
    `.trim();
  }, [isEnabled]);

  const contextValue: ReplContextType = {
    isEnabled,
    setEnabled,
    isAvailable,
    replTools,
    replInstructions,
  };

  return (
    <ReplContext.Provider value={contextValue}>
      {children}
    </ReplContext.Provider>
  );
}
