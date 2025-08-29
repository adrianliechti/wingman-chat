import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import { ShareButton } from './ShareButton';
import { PlayButton } from './PlayButton';
import { SingleAttachmentDisplay, MultipleAttachmentsDisplay } from './AttachmentRenderer';
import { Wrench, Loader2, AlertCircle } from "lucide-react";
import { useState, useContext, useEffect } from 'react';
import { codeToHtml } from 'shiki';
import { ThemeContext } from '../contexts/ThemeContext';

import { Role } from "../types/chat";
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
        return value;
      }
    }
    
    // If no common params found, try to find any string value
    const stringValues = Object.values(args).filter(v => 
      typeof v === 'string' && v.length > 0
    );
    
    if (stringValues.length > 0) {
      const value = stringValues[0] as string;
      return value;
    }
    
    return null;
  } catch {
    // If parsing fails, try to extract simple quoted strings
    const match = arguments_.match(/"([^"]+)"/);
    if (match) {
      return match[1];
    }
    return null;
  }
}

type ChatMessageProps = {
  message: Message;
  isLast?: boolean;
  isResponding?: boolean;
};

// Component to render code with Shiki
function ShikiCodeRenderer({ content, name }: { content: string; name?: string }) {
  const [html, setHtml] = useState<string>('');
  const { isDark } = useContext(ThemeContext) || { isDark: false };

  useEffect(() => {
    const renderCode = async () => {
      let isJson = false;
      let parsedContent = null;
      let langId = 'text';
      
      // Try to parse as JSON
      try {
        parsedContent = JSON.parse(content);
        isJson = true;
        langId = 'json';
      } catch {
        // Not JSON, treat as text
        langId = 'text';
      }

      const displayContent = isJson ? JSON.stringify(parsedContent, null, 2) : content;

      try {
        const renderedHtml = await codeToHtml(displayContent, {
          lang: langId,
          theme: isDark ? 'one-dark-pro' : 'one-light',
          colorReplacements: {
            '#fafafa': 'transparent', // one-light background
            '#282c34': 'transparent', // one-dark-pro background
          }
        });
        setHtml(renderedHtml);
      } catch {
        // Fallback to plain text if Shiki fails
        setHtml(`<pre><code>${displayContent}</code></pre>`);
      }
    };

    renderCode();
  }, [content, isDark]);

  return (
    <div className="mt-3">
      {name && (
        <div className="text-xs text-neutral-500 dark:text-neutral-500 mb-1 opacity-60">
          {name}
        </div>
      )}
      <div className="max-h-96 overflow-y-auto overflow-x-hidden">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

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

    // Helper to render JSON or text content using Shiki
    const renderContent = (content: string, name?: string) => {
      return <ShikiCodeRenderer content={content} name={name} />;
    };

    return (
      <div className="flex justify-start mb-2">
        <div className="flex-1 py-1 max-w-full">
          <div className={`${isToolError ? 'bg-red-50/30 dark:bg-red-950/5' : ''} rounded-lg overflow-hidden max-w-full`}>
            {/* Header - clickable to expand/collapse */}
            <button 
              onClick={toggleExpansion}
              className="w-full flex items-center text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isToolError ? (
                  <AlertCircle className="w-3 h-3 text-red-400 dark:text-red-500 flex-shrink-0" />
                ) : (
                  <Wrench className="w-3 h-3 text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
                )}
                <span className={`text-xs font-medium whitespace-nowrap ${
                  isToolError 
                    ? "text-red-500 dark:text-red-400" 
                    : "text-neutral-500 dark:text-neutral-400"
                }`}>
                  {isToolError ? 'Tool Error' : `${toolResult?.name ? getToolDisplayName(toolResult.name) : 'Tool'}`}
                </span>
                {queryPreview && !toolResultExpanded && (
                  <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                    {queryPreview}
                  </span>
                )}
              </div>
            </button>

            {/* Expanded Content */}
            {toolResultExpanded && (
              <div className="ml-5">
                {toolResult?.arguments && renderContent(toolResult.arguments, 'Arguments')}
                {(message.error || message.content || toolResult?.data) && (
                  message.error ? (
                    <ShikiCodeRenderer 
                      content={message.error.message}
                      name="Error"
                    />
                  ) : (
                    renderContent(message.content || toolResult?.data || '', 'Result')
                  )
                )}
              </div>
            )}
          </div>
          
          {/* Tool Attachments rendered after the Tool Result container */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2">
              {/* For tool messages: single if one, otherwise multiple */}
              {message.attachments.length === 1 ? (
                <SingleAttachmentDisplay attachment={message.attachments[0]} />
              ) : (
                <MultipleAttachmentsDisplay attachments={message.attachments} />
              )}
            </div>
          )}
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
                  <div key={toolCall.id || index} className="rounded-lg overflow-hidden max-w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 flex-shrink-0" />
                      <span className="text-xs font-medium whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                        {getToolDisplayName(toolCall.name)}
                      </span>
                      {preview && (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
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
                  <div key={toolCall.id || index} className="rounded-lg overflow-hidden max-w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 flex-shrink-0" />
                      <span className="text-xs font-medium whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                        {getToolDisplayName(toolCall.name)}
                      </span>
                      {preview && (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
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
            <div className="pt-2">
              {/* For user messages: always use multiple display; assistant follows single vs multiple */}
              {isUser ? (
                <MultipleAttachmentsDisplay attachments={message.attachments} />
              ) : message.attachments.length === 1 ? (
                <SingleAttachmentDisplay attachment={message.attachments[0]} />
              ) : (
                <MultipleAttachmentsDisplay attachments={message.attachments} />
              )}
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
