import { memo, useState, useEffect } from 'react';
import { Code2, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Button, Menu, MenuButton, MenuItem, MenuItems, Textarea } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '../types/workflow';
import type { Model, Tool } from '../types/chat';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { executeCode } from '../lib/interpreter';
import { getConfig } from '../config';
import { Role } from '../types/chat';
import { WorkflowNode } from './WorkflowNode';
import { CopyButton } from './CopyButton';

// CodeNode data interface
export interface CodeNodeData extends BaseNodeData {
  prompt?: string;
  model?: string;
  generatedCode?: string;
}

// CodeNode type
export type CodeNodeType = Node<CodeNodeData, 'code'>;

export const CodeNode = memo(({ id, data, selected }: NodeProps<CodeNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getLabeledText, isProcessing, executeAsync } = useWorkflowNode(id);
  const [models, setModels] = useState<Model[]>([]);
  const [showCode, setShowCode] = useState(false);
  const config = getConfig();
  const client = config.client;

  useEffect(() => {
    const loadModels = async () => {
      try {
        const modelList = await client.listModels("completion");
        setModels(modelList);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    };
    loadModels();
  }, [client]);

  const handleExecute = async () => {
    if (!data.prompt?.trim()) return;
    
    await executeAsync(async () => {
      // Get labeled text from connected nodes
      const contextText = getLabeledText();
      
      // Build the user message content
      let messageContent = data.prompt || '';
      
      // If there's connected data, append it as context
      if (contextText) {
        messageContent = `${messageContent}\n\n---\n\nInput data from connected nodes:\n${contextText}`;
      }

      try {
        let generatedCode = '';
        let packages: string[] = [];

        // Define the execute_python_code tool for function calling
        const tools: Tool[] = [{
          name: "execute_python_code",
          description: "Execute Python code to solve the task. Use this to perform calculations, data analysis, create visualizations, or run any Python script.",
          parameters: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The Python code to execute. Can include imports, functions, calculations, and print statements. If input_data is available from connected nodes, it will be accessible as a variable."
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
            generatedCode = args.code as string;
            packages = (args.packages as string[]) || [];
            return "Code will be executed";
          }
        }];

        // Call the complete method with the tool
        const response = await client.complete(
          data.model || '',
          'You are a Python code generator. Generate clean, efficient Python code to solve the user\'s task. Use the execute_python_code function to run the code. If input_data is available, use it in your solution.\n\nIMPORTANT: Only generate code that produces TEXT OUTPUT using print() statements or returns values. Do NOT create files, save data to disk, or generate file paths. All output must be text-based and printed to stdout.',
          [{
            role: Role.User,
            content: messageContent,
          }],
          tools
        );

        // Check if tool was called
        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolCall = response.toolCalls[0];
          const args = JSON.parse(toolCall.arguments);
          generatedCode = args.code;
          packages = args.packages || [];

          // Update node to show generated code
          updateNode(id, {
            data: { ...data, generatedCode, outputText: 'Executing code...', error: undefined }
          });

          // Build execution code with input_data if available
          let executionCode = generatedCode;
          if (contextText) {
            const escapedContext = JSON.stringify(contextText).slice(1, -1);
            
            executionCode = `# Input data from connected nodes
input_data = """${escapedContext}"""

${generatedCode}`;
          }

          // Execute the Python code
          const result = await executeCode({
            code: executionCode,
            packages: packages
          });

          if (!result.success) {
            updateNode(id, {
              data: { 
                ...data, 
                generatedCode,
                outputText: '', 
                error: result.error || 'Code execution failed' 
              }
            });
            return;
          }

          // Update with the execution result
          updateNode(id, {
            data: { 
              ...data, 
              generatedCode,
              outputText: result.output, 
              error: undefined 
            }
          });
        } else {
          // If no tool was called, use the response content as error
          updateNode(id, {
            data: { 
              ...data, 
              error: 'Failed to generate code: ' + (response.content || 'No code generated')
            }
          });
        }
      } catch (error) {
        console.error('Error executing code generation:', error);
        updateNode(id, {
          data: { 
            ...data, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          }
        });
      }
    });
  };

  const currentModel = models.find(m => m.id === data.model);

  const modelSelector = (
    <Menu>
      <MenuButton className="nodrag inline-flex items-center gap-1 px-2 py-1 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 text-xs transition-colors rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="opacity-50" />
        <span>
          {currentModel?.name || 'Default'}
        </span>
      </MenuButton>
      <MenuItems
        transition
        anchor="bottom end"
        className="max-h-[50vh]! mt-1 rounded-lg bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-lg border border-neutral-200 dark:border-neutral-700 overflow-y-auto shadow-lg z-50 min-w-[200px]"
      >
        {models.length === 0 ? (
          <div className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
            No models available
          </div>
        ) : (
          models.map((model) => (
            <MenuItem key={model.id}>
              <Button
                onClick={() => updateNode(id, { data: { ...data, model: model.id } })}
                className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
              >
                {model.name}
              </Button>
            </MenuItem>
          ))
        )}
      </MenuItems>
    </Menu>
  );

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Code2}
      title="Code"
      color="green"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={!!data.prompt?.trim()}
      showInputHandle={true}
      showOutputHandle={true}
      error={data.error}
      headerActions={
        <>
          {modelSelector}
          {data.outputText && <CopyButton text={data.outputText} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Prompt Input */}
        <div className="shrink-0">
          <Textarea
            value={data.prompt ?? ''}
            onChange={(e) => updateNode(id, { data: { ...data, prompt: e.target.value } })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Describe what you want the code to do..."
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg bg-white/50 dark:bg-black/20 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30 focus:outline-none transition-all resize-y min-h-[60px] nodrag"
          />
        </div>

        {/* Output or Code Display */}
        {showCode && data.generatedCode ? (
          <div className="flex-1 overflow-y-auto px-3 py-2 text-xs font-mono rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide whitespace-pre-wrap nodrag">
            {data.generatedCode && (
              <button
                onClick={() => setShowCode(!showCode)}
                title="Show Output"
                className="float-right ml-2 inline-flex items-center justify-center size-6 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors rounded-md hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50"
              >
                <EyeOff size={14} />
              </button>
            )}
            {data.generatedCode}
          </div>
        ) : data.outputText ? (
          <div className="flex-1 overflow-y-auto px-3 py-2 text-sm font-mono rounded-lg bg-gray-100/50 dark:bg-black/10 scrollbar-hide whitespace-pre-wrap nodrag">
            {data.generatedCode && (
              <button
                onClick={() => setShowCode(!showCode)}
                title="Show Code"
                className="float-right ml-2 inline-flex items-center justify-center size-6 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors rounded-md hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50"
              >
                <Eye size={14} />
              </button>
            )}
            {data.outputText}
          </div>
        ) : null}
      </div>
    </WorkflowNode>
  );
});
