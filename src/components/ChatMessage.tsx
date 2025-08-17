import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import { ShareButton } from './ShareButton';
import { PlayButton } from './PlayButton';
import { CodeRenderer } from './CodeRenderer';
import { File, Wrench, Loader2, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { useState } from 'react';

import { AttachmentType, Role } from "../types/chat";
import type { Message } from "../types/chat";
import { getConfig } from "../config";
import { canShare } from "../lib/share";
import { stripMarkdown } from "../lib/utils";

// Helper function to convert tool names to user-friendly display names
function getToolDisplayName(toolName: string): string {
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Helper function to extract and format common parameters for tool calls
function getToolCallPreview(_toolName: string, arguments_: string): string | null {
  try {
    const args = JSON.parse(arguments_);
    
    // Common parameter names to look for (in order of preference)
    const commonParams = [
      'query', 'q', 'search', 'search_query',
      'url', 'link', 'address',
      'file', 'filename', 'path', 'filepath',
      'text', 'content', 'message', 'data',
      'prompt', 'input',
      'location', 'city', 'place',
      'email', 'to', 'recipient',
      'title', 'name', 'subject',
      'code', 'script', 'command'
    ];
    
    // Find the first matching parameter
    for (const param of commonParams) {
      if (args[param] && typeof args[param] === 'string') {
        const value = args[param].toString();
        // Truncate long values
        if (value.length > 50) {
          return `"${value.substring(0, 47)}..."`;
        }
        return `"${value}"`;
      }
    }
    
    // If no common params found, try to find any string value
    const stringValues = Object.values(args).filter(v => 
      typeof v === 'string' && v.length > 0 && v.length < 100
    );
    
    if (stringValues.length > 0) {
      const value = stringValues[0] as string;
      if (value.length > 50) {
        return `"${value.substring(0, 47)}..."`;
      }
      return `"${value}"`;
    }
    
    return null;
  } catch {
    // If parsing fails, try to extract simple quoted strings
    const match = arguments_.match(/"([^"]{1,50})"/);
    if (match) {
      return `"${match[1]}"`;
    }
    return null;
  }
}

type ChatMessageProps = {
  message: Message;
  isLast?: boolean;
  isResponding?: boolean;
};

// Error message component
function ErrorMessage({ title, message }: { title: string; message: string }) {
  const displayTitle = title
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, l => l.toUpperCase());
  const displayMessage = message || 'An error occurred'; // Show message if available, otherwise generic message

  return (
    <div className="flex justify-start mb-4">
      <div className="flex-1 py-3">
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 rounded-lg p-4 max-w-none">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-red-800 dark:text-red-200 mb-1">
                {displayTitle}
              </h4>
              <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed">
                {displayMessage}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatMessage({ message, isResponding, ...props }: ChatMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  
  const isUser = message.role === Role.User;
  const isAssistant = message.role === Role.Assistant;
  
  const hasToolCalls = message.role === Role.Assistant && message.toolCalls && message.toolCalls.length > 0;
  const isToolResult = message.role === Role.Tool;
  
  const config = getConfig();
  const enableTTS = config.tts;
  
  const canShareMessage = canShare("Shared Message", message.content?.replace(/'/g, "'") || "");

  // Handle tool messages
  if (isToolResult) {
    const toolResult = message.toolResult;

    // Get the query preview from tool arguments (similar to tool call)
    const queryPreview = toolResult?.arguments ? getToolCallPreview(toolResult.name || '', toolResult.arguments) : null;

    const toggleExpansion = () => setToolResultExpanded(!toolResultExpanded);

    // Check if this is a tool error (using error field)
    const isToolError = !!message.error;
    const borderColor = isToolError ? "border-red-200 dark:border-red-800" : "border-neutral-200 dark:border-neutral-700";
    const bgColor = isToolError ? "bg-red-50/50 dark:bg-red-950/10" : "";

    // Helper to render JSON or text content
    const renderContent = (content: string, name?: string) => {
      let isJson = false;
      let parsedContent = null;
      let detectedLanguage = 'text';
      
      // Try to parse as JSON
      try {
        parsedContent = JSON.parse(content);
        isJson = true;
        detectedLanguage = 'json';
      } catch {
        // Not JSON, treat as text
        detectedLanguage = 'text';
      }

      return (
        <div className="mt-3 max-w-full">
          <div className="max-w-full overflow-auto" style={{ maxHeight: '400px' }}>
            <CodeRenderer 
              code={isJson ? JSON.stringify(parsedContent, null, 2) : content}
              language={detectedLanguage}
              name={name}
            />
          </div>
        </div>
      );
    };

    return (
      <div className="flex justify-start mb-2">
        <div className="flex-1 py-1 max-w-full">
          <div className={`border ${borderColor} ${bgColor} rounded-md overflow-hidden max-w-full`}>
            {/* Header - clickable to expand/collapse */}
            <button 
              onClick={toggleExpansion}
              className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isToolError ? (
                  <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                ) : (
                  <Wrench className="w-3 h-3 text-neutral-500 flex-shrink-0" />
                )}
                <span className={`text-xs font-medium whitespace-nowrap ${
                  isToolError 
                    ? "text-red-600 dark:text-red-400" 
                    : "text-neutral-600 dark:text-neutral-400"
                }`}>
                  {isToolError ? 'Tool Error' : `Called ${toolResult?.name ? getToolDisplayName(toolResult.name) : 'Tool'} Tool`}
                </span>
                {queryPreview && !toolResultExpanded && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono truncate">
                    {queryPreview}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {toolResultExpanded ? 
                  <ChevronDown className="w-3 h-3 text-neutral-500" /> : 
                  <ChevronRight className="w-3 h-3 text-neutral-500" />
                }
              </div>
            </button>

            {/* Expanded Content */}
            {toolResultExpanded && (
              <div className={`px-2 border-t max-w-full overflow-hidden ${
                isToolError ? "border-red-200 dark:border-red-800" : "border-neutral-200 dark:border-neutral-700"
              }`}>
                {toolResult?.arguments && renderContent(toolResult.arguments, 'Arguments')}
                {(message.error || message.content || toolResult?.data) && (
                  message.error ? (
                    // Show error messages in a more readable format
                    <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-800">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-red-700 dark:text-red-300">
                          {message.error.message}
                        </div>
                      </div>
                    </div>
                  ) : (
                    renderContent(message.content || toolResult?.data || '', 'Result')
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Handle assistant messages with no content (loading states)
  if (isAssistant && !message.content && !message.error) {
    // Skip rendering old tool call messages that aren't the last one
    if (hasToolCalls && !props.isLast) {
      return null;
    }
    
    // Only show loading indicators for the last message when actively responding
    if (!isResponding || !props.isLast) {
      return null;
    }
    
    // Show tool call indicators if there are tool calls
    if (hasToolCalls) {
      return (
        <div className="flex justify-start mb-2">
          <div className="flex-1 py-1 max-w-full">
            <div className="space-y-1">
              {message.toolCalls?.map((toolCall, index) => {
                const preview = getToolCallPreview(toolCall.name, toolCall.arguments);
                return (
                  <div key={toolCall.id || index} className="border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden max-w-full">
                    <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                      <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                      <span className="text-xs font-medium whitespace-nowrap text-neutral-600 dark:text-neutral-400">
                        Calling {getToolDisplayName(toolCall.name)} Tool
                      </span>
                      {preview && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono truncate">
                          {preview}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    
    // Show loading animation for regular assistant responses
    return (
      <div className="flex justify-start mb-4">
        <div className="flex-1 py-3">
          <div className="space-y-2">
            <div className="flex space-x-1">
              <div className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Handle user and assistant messages with content
  if (isUser || (isAssistant && (message.content || message.error))) {
    // Check if this is an error message (using the error field)
    if (isAssistant && message.error) {
      return <ErrorMessage title={message.error.code || 'Error'} message={message.error.message} />;
    }
    
    return (
      <div
        className={`flex chat-bubble ${isUser ? "justify-end" : "justify-start"} mb-4 ${!isUser && isResponding && props.isLast ? '' : 'group'}`}
      >
        <div
          className={`${
            isUser 
              ? "rounded-lg py-3 px-3 chat-bubble-user" 
              : "flex-1 py-3"
          } break-words overflow-x-auto`}
        >
          {isUser ? (
            <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
          ) : (
            message.content && <Markdown>{message.content}</Markdown>
          )}

          {/* Show tool call indicators for assistant messages with tool calls */}
          {!isUser && hasToolCalls && props.isLast && (
            <div className="mt-3 space-y-1">
              {message.toolCalls?.map((toolCall, index) => {
                const preview = getToolCallPreview(toolCall.name, toolCall.arguments);
                return (
                  <div key={toolCall.id || index} className="border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden max-w-full">
                    <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                      <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                      <span className="text-xs font-medium whitespace-nowrap text-neutral-600 dark:text-neutral-400">
                        Calling {getToolDisplayName(toolCall.name)} Tool
                      </span>
                      {preview && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono truncate">
                          {preview}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                {message.attachments
                  .filter(
                    (attachment) => attachment.type !== AttachmentType.Image
                  )
                  .map((attachment, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <File className="w-4 h-4 shrink-0" />
                      <span className="truncate">{attachment.name}</span>
                    </div>
                  ))}
              </div>

              <div className="flex flex-wrap gap-4">
                {message.attachments
                  .filter(
                    (attachment) => attachment.type === AttachmentType.Image
                  )
                  .map((attachment, index) => (
                    <img
                      key={index}
                      src={attachment.data}
                      className="max-h-60 rounded-md"
                      alt={attachment.name}
                    />
                  ))}
              </div>
            </div>
          )}
          
          {!isUser && (
            <div className={`flex justify-between items-center mt-2 ${
              props.isLast && !isResponding ? 'chat-message-actions !opacity-100' : 'chat-message-actions opacity-0'
            }`}>
              <div className="flex items-center gap-2">
                {canShareMessage && <ShareButton text={stripMarkdown(message.content || '')} className="h-4 w-4" />}
                <CopyButton text={stripMarkdown(message.content || '')} className="h-4 w-4" />
                {enableTTS && <PlayButton text={message.content} className="h-4 w-4" />}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Unknown message type - render nothing
  return null;
}
