/**
 * Simplified tool execution loop for notebooks.
 * Calls client.complete(), executes any tool calls, re-calls until done.
 */

import type { Client } from '@/shared/lib/client';
import type { Message, Content, Tool } from '@/shared/types/chat';

/**
 * Run an LLM completion with tool support.
 * Loops until the model stops calling tools.
 */
export async function runWithTools(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  onStream?: (content: Content[]) => void,
): Promise<Message> {
  let conversation = [...messages];

  while (true) {
    const assistantMessage = await client.complete(
      model,
      instructions,
      conversation,
      tools,
      onStream,
    );

    conversation = [...conversation, assistantMessage];

    const toolCalls = assistantMessage.content.filter(
      (p) => p.type === 'tool_call',
    );

    if (toolCalls.length === 0) {
      return assistantMessage;
    }

    // Execute each tool call
    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'tool_call') continue;

      const tool = tools.find((t) => t.name === toolCall.name);

      if (!tool) {
        conversation = [
          ...conversation,
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                result: [
                  {
                    type: 'text' as const,
                    text: `Error: Tool "${toolCall.name}" not found.`,
                  },
                ],
              },
            ],
          },
        ];
        continue;
      }

      try {
        const args = JSON.parse(toolCall.arguments || '{}');
        const result = await tool.function(args);

        conversation = [
          ...conversation,
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                result,
              },
            ],
          },
        ];
      } catch (error) {
        conversation = [
          ...conversation,
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                result: [
                  {
                    type: 'text' as const,
                    text: `Error: ${error instanceof Error ? error.message : 'Tool execution failed.'}`,
                  },
                ],
              },
            ],
          },
        ];
      }
    }
  }
}
