import { useState, useCallback, useMemo } from 'react';
import { Package } from 'lucide-react';
import { getConfig } from '../config';
import type { Tool, ToolProvider } from '../types/chat';
import interpreterInstructionsText from '../prompts/interpreter.txt?raw';
import { executeCode } from "../lib/interpreter";

export function useInterpreterProvider(): ToolProvider | null {
  const [isEnabled, setEnabled] = useState(false);
  const config = getConfig();
  
  const isAvailable = useMemo(() => {
    try {
      return config.interpreter.enabled;
    } catch (error) {
      console.warn('Failed to get interpreter config:', error);
      return false;
    }
  }, [config.interpreter.enabled]);

  const interpreterTools = useCallback((): Tool[] => {
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

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: 'interpreter',
      name: 'Interpreter',
      description: 'Use Python engine',
      icon: Package,
      instructions: interpreterInstructionsText,
      tools: async () => interpreterTools(),
      isEnabled: isEnabled,
      isInitializing: false,
      setEnabled: setEnabled,
    };
  }, [isAvailable, isEnabled, interpreterTools]);

  return provider;
}
