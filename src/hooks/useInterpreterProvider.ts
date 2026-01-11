import { useCallback, useMemo } from 'react';
import { SquareChevronRight } from 'lucide-react';
import { getConfig } from '../config';
import type { Tool, ToolProvider } from '../types/chat';
import interpreterInstructionsText from '../prompts/interpreter.txt?raw';
import { executeCode } from "../lib/interpreter";

export function useInterpreterProvider(): ToolProvider | null {
  const config = getConfig();
  
  const isAvailable = useMemo(() => {
    try {
      return !!config.interpreter;
    } catch (error) {
      console.warn('Failed to get interpreter config:', error);
      return false;
    }
  }, [config.interpreter]);

  const interpreterTools = useCallback((): Tool[] => {
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
          
          try {
            const result = await executeCode({
              code: code as string,
              packages: packages as string[] | undefined
            });
            
            if (!result.success) {
              return `Error executing code: ${result.error || 'Unknown error'}`;
            }

            return result.output;
          } catch (error) {
            return `Code execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        }
      }
    ];
  }, []);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: 'interpreter',
      name: 'Interpreter',
      description: 'Use Python engine',
      icon: SquareChevronRight,
      instructions: interpreterInstructionsText,
      tools: interpreterTools(),
    };
  }, [isAvailable, interpreterTools]);

  return provider;
}
