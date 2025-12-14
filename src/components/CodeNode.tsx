import { memo, useState, useEffect } from 'react';
import { Code2, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData, Data } from '../types/workflow';
import { getDataText } from '../types/workflow';
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
  const { connectedData, isProcessing, executeAsync } = useWorkflowNode(id);
  const [models, setModels] = useState<Model[]>([]);
  const [showCode, setShowCode] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const config = getConfig();
  const client = config.client;

  useEffect(() => {
    const loadModels = async () => {
      try {
        const modelList = await client.listModels("completer");
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
      try {
        // Get input items from connected nodes
        const inputItems = connectedData.items;
        
        // If no inputs, create a single execution without input data
        const itemsToProcess = inputItems.length > 0 
          ? inputItems 
          : [{ value: '', text: '' }];

        let generatedCode = '';
        let packages: string[] = [];

        // Build the prompt with a sample input to generate the code
        const sampleInput = itemsToProcess[0]?.text || '';
        let messageContent = data.prompt || '';
        
        if (sampleInput) {
          messageContent = `${messageContent}\n\n---\n\nSample input data (the code will be run for each input item):\n${sampleInput}`;
        }

        // Define the execute_python_code tool for function calling
        const tools: Tool[] = [{
          name: "execute_python_code",
          description: "Execute Python code to solve the task. Use this to perform calculations, data analysis, create visualizations, or run any Python script. The variable 'input_data' will contain the input text to process.",
          parameters: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "The Python code to execute. The variable 'input_data' will be available containing the input text to process. Use print() to output the result."
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
          `You are a Python code generator. Generate clean, efficient Python code to solve the user's task. Use the execute_python_code function to run the code.

The variable 'input_data' will contain the text input to process. Your code will be executed once for each input item.

IMPORTANT: 
- Only generate code that produces TEXT OUTPUT using print() statements
- The 'input_data' variable is already defined and contains the input text
- Do NOT create files, save data to disk, or generate file paths
- All output must be text-based and printed to stdout`,
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

          // Update node to show generated code and processing status
          updateNode(id, {
            data: { 
              ...data, 
              generatedCode, 
              output: { items: [{ value: 'Executing code...', text: 'Executing code...' }] }, 
              error: undefined 
            }
          });

          // Execute the code for each input item
          const resultItems: { value: string; text: string }[] = [];
          
          for (const item of itemsToProcess) {
            const inputText = item.text;
            const escapedInput = JSON.stringify(inputText).slice(1, -1);
            
            // Build execution code with input_data
            const executionCode = `# Input data for this execution
input_data = """${escapedInput}"""

${generatedCode}`;

            // Execute the Python code
            const result = await executeCode({
              code: executionCode,
              packages: packages
            });

            if (!result.success) {
              resultItems.push({ 
                value: result.error || 'Code execution failed', 
                text: `Error: ${result.error || 'Code execution failed'}` 
              });
            } else {
              resultItems.push({ 
                value: result.output, 
                text: result.output 
              });
            }
          }

          // Update output with all results
          const output: Data<string> = {
            items: resultItems
          };

          updateNode(id, {
            data: { 
              ...data, 
              generatedCode,
              output, 
              error: undefined 
            }
          });

          // Reset to first tab if current tab would be out of bounds
          if (activeTab >= resultItems.length) {
            setActiveTab(0);
          }
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
  const outputItems = data.output?.items || [];
  const hasMultipleOutputs = outputItems.length > 1;

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
              <button
                type="button"
                onClick={() => updateNode(id, { data: { ...data, model: model.id } })}
                className="group flex w-full items-center px-4 py-2 data-focus:bg-neutral-100 dark:data-focus:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition-colors text-xs"
              >
                {model.name}
              </button>
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
          {data.output && <CopyButton text={getDataText(data.output)} />}
        </>
      }
    >
      <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
        {/* Prompt Input */}
        <div className="shrink-0">
          <textarea
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
        ) : outputItems.length > 0 ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`flex-1 overflow-y-auto px-3 py-2 text-sm font-mono bg-gray-100/50 dark:bg-black/10 scrollbar-hide whitespace-pre-wrap nodrag ${hasMultipleOutputs ? 'rounded-t-lg' : 'rounded-lg'}`}>
              {data.generatedCode && (
                <button
                  onClick={() => setShowCode(!showCode)}
                  title="Show Code"
                  className="float-right ml-2 inline-flex items-center justify-center size-6 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors rounded-md hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50"
                >
                  <Eye size={14} />
                </button>
              )}
              {outputItems[activeTab]?.text || ''}
            </div>
            {/* Tab navigation at bottom - only show if multiple outputs */}
            {hasMultipleOutputs && (
              <div className="shrink-0 flex items-center justify-between px-2 py-1.5 bg-gray-200/50 dark:bg-black/20 rounded-b-lg border-t border-gray-200/50 dark:border-gray-700/50">
                <button
                  onClick={() => setActiveTab(Math.max(0, activeTab - 1))}
                  disabled={activeTab === 0}
                  className="p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 disabled:opacity-30 transition-colors nodrag"
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="flex items-center gap-1">
                  {outputItems.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveTab(idx)}
                      className={`w-6 h-6 text-xs rounded transition-colors nodrag ${
                        idx === activeTab
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-300/50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 hover:bg-gray-400/50 dark:hover:bg-gray-600/50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setActiveTab(Math.min(outputItems.length - 1, activeTab + 1))}
                  disabled={activeTab === outputItems.length - 1}
                  className="p-1 rounded hover:bg-gray-300/50 dark:hover:bg-gray-700/50 disabled:opacity-30 transition-colors nodrag"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </WorkflowNode>
  );
});
