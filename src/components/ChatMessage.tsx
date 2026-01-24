import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import { PlayButton } from './PlayButton';
import { SingleAttachmentDisplay, MultipleAttachmentsDisplay } from './AttachmentRenderer';
import { CodeRenderer } from './CodeRenderer';
import { Wrench, Loader2, AlertCircle, ShieldQuestion, Check, X, Pencil, ChevronRight } from "lucide-react";
import { useState, useRef, useEffect } from 'react';

import { Role } from "../types/chat";
import type { Message, ElicitationResult, Content } from "../types/chat";
import { getConfig } from "../config";
import { useChat } from "../hooks/useChat";

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
    // Prioritize short, descriptive fields over potentially long content
    const commonParams = [
      // Identification (short & descriptive)
      'title', 'name', 'label',
      // Location (usually short)
      'city', 'location', 'place',
      // Web & Network (usually concise)
      'url', 'link', 'uri', 'endpoint', 'address',
      // Files & Paths (usually concise)
      'filename', 'file', 'path', 'filepath', 'folder', 'directory',
      // Communication (usually short)
      'subject', 'email', 'recipient', 'to',
      // Commands (usually short)
      'command',
      // Search & Query (can vary in length, but often short)
      'query', 'search', 'keyword', 'q', 'search_query', 'term',
      // Short inputs
      'question', 'input', 'value',
      // Potentially long content (last resort)
      'message', 'prompt', 'instruction', 'text', 'content', 'body', 'data'
    ];
    
    // Find the first matching parameter
    for (const param of commonParams) {
      if (args[param] && typeof args[param] === 'string') {
        return args[param];
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

// Helper function to extract code from arguments
function extractCodeFromArguments(arguments_: string): { code: string; packages?: string[] } | null {
  try {
    const args = JSON.parse(arguments_);
    if (args.code && typeof args.code === 'string') {
      return {
        code: args.code,
        packages: args.packages
      };
    }
    return null;
  } catch {
    return null;
  }
}

type ChatMessageProps = {
  index: number;

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
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
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

// Elicitation prompt component for tool approval/denial
type ElicitationPromptProps = {
  toolName: string;
  message: string;
  onResolve: (result: ElicitationResult) => void;
};

function ElicitationPrompt({ toolName, message, onResolve }: ElicitationPromptProps) {
  return (
    <div className="rounded-lg overflow-hidden max-w-full">
      <div className="flex items-start gap-2 min-w-0">
        <ShieldQuestion className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="mb-1">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {getToolDisplayName(toolName)}
            </span>
            <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
              {message}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onResolve({ action: 'accept' })}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
            >
              <Check className="w-3 h-3" />
              Approve
            </button>
            <button
              onClick={() => onResolve({ action: 'decline' })}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-300 transition-colors"
            >
              <X className="w-3 h-3" />
              Deny
            </button>
            <button
              onClick={() => onResolve({ action: 'cancel' })}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Reasoning/Thinking display component - shows model's thinking process in collapsible UI
type ReasoningDisplayProps = {
  reasoning: string;
  isStreaming?: boolean;
};

function ReasoningDisplay({ reasoning, isStreaming }: ReasoningDisplayProps) {
  // Start expanded when streaming, collapsed when viewing completed message
  const [isExpanded, setIsExpanded] = useState(isStreaming ?? false);

  // Show component if we have reasoning content OR if we're streaming (thinking in progress)
  if (!reasoning && !isStreaming) return null;

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        <span className="font-medium">Thinking</span>
        {isStreaming && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
      </button>
      
      {isExpanded && (
        <div className="mt-2 pl-5 border-l-2 border-neutral-200 dark:border-neutral-700">
          <div className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message, index, isResponding, ...props }: ChatMessageProps) {
  const [toolResultExpanded, setToolResultExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { pendingElicitation, resolveElicitation, sendMessage, chat } = useChat();
  
  const isUser = message.role === Role.User;
  const isAssistant = message.role === Role.Assistant;
  
  const hasToolCalls = message.role === Role.Assistant && message.toolCalls && message.toolCalls.length > 0;
  const isToolResult = message.role === Role.Tool;
  
  const config = getConfig();
  const enableTTS = !!config.tts;

  // Auto-resize textarea and focus when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing]);

  // Auto-resize textarea on content change
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editContent]);

  const handleStartEdit = () => {
    if (isResponding) return;
    setEditContent(message.content || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(message.content || '');
  };

  const handleConfirmEdit = async () => {
    if (editContent.trim() === '' || !chat) return;
    setIsEditing(false);
    
    // Truncate history and send edited message
    const truncatedHistory = chat.messages.slice(0, index);
    const editedMessage = { ...message, content: editContent };
    await sendMessage(editedMessage, truncatedHistory);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleConfirmEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  // Handle tool messages
  if (isToolResult) {
    const toolResult = message.toolResult;
    const isToolError = !!message.error;
    const codeData = toolResult?.arguments ? extractCodeFromArguments(toolResult.arguments) : null;
    const queryPreview = !codeData && toolResult?.arguments 
      ? getToolCallPreview(toolResult.name || '', toolResult.arguments) 
      : null;

    const renderContent = (content: string | Content[], name?: string) => {
      if (typeof content === 'string') {
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(content);
          const formatted = JSON.stringify(parsed, null, 2);
          return <CodeRenderer code={formatted} language="json" name={name} />;
        } catch {
          // Not JSON, render as text
          return <CodeRenderer code={content} language="text" name={name} />;
        }
      } else {
        // Content[] - stringify and render as JSON
        const formatted = JSON.stringify(content, null, 2);
        return <CodeRenderer code={formatted} language="json" name={name} />;
      }
    };

    const getPreviewText = () => {
      if (codeData) return codeData.code.split('\n')[0];
      if (queryPreview) return queryPreview;
      return null;
    };

    return (
      <div className="flex justify-start mb-2">
        <div className="flex-1 py-1 max-w-full">
          <div className={`${isToolError ? 'bg-red-50/30 dark:bg-red-950/5' : ''} rounded-lg overflow-hidden max-w-full`}>
            <button 
              onClick={() => setToolResultExpanded(!toolResultExpanded)}
              className="w-full flex items-center text-left transition-colors"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isToolError ? (
                  <AlertCircle className="w-3 h-3 text-red-400 dark:text-red-500 shrink-0" />
                ) : (
                  <Wrench className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
                )}
                <span className={`text-xs font-medium whitespace-nowrap ${
                  isToolError 
                    ? "text-red-500 dark:text-red-400" 
                    : "text-neutral-500 dark:text-neutral-400"
                }`}>
                  {isToolError ? 'Tool Error' : `${toolResult?.name ? getToolDisplayName(toolResult.name) : 'Tool'}`}
                </span>
                {!toolResultExpanded && getPreviewText() && (
                  <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                    {getPreviewText()}
                  </span>
                )}
              </div>
            </button>

            {toolResultExpanded && (
              <div className="ml-5">
                {codeData ? (
                  <CodeRenderer code={codeData.code} language="python" />
                ) : (
                  toolResult?.arguments && renderContent(toolResult.arguments, 'Arguments')
                )}
                {(message.error || message.content || toolResult?.data) && (
                  message.error ? (
                    <CodeRenderer 
                      code={message.error.message}
                      language="text"
                      name="Error"
                    />
                  ) : (
                    renderContent(message.content || toolResult?.data || '', 'Result')
                  )
                )}
              </div>
            )}
          </div>
          
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2">
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
    
    // Check if there's a pending elicitation for any of the tool calls
    const hasPendingElicitation = hasToolCalls && message.toolCalls?.some(
      toolCall => pendingElicitation && pendingElicitation.toolCallId === toolCall.id
    );
    
    // Show loading indicators for the last message when actively responding OR when there's a pending elicitation
    if (!props.isLast || (!isResponding && !hasPendingElicitation)) {
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
                const isPendingElicitation = pendingElicitation && pendingElicitation.toolCallId === toolCall.id;
                
                // Show elicitation prompt if this tool call has a pending elicitation
                if (isPendingElicitation) {
                  return (
                    <ElicitationPrompt
                      key={toolCall.id || index}
                      toolName={pendingElicitation.toolName}
                      message={pendingElicitation.elicitation.message}
                      onResolve={resolveElicitation}
                    />
                  );
                }
                
                return (
                  <div key={toolCall.id || index} className="rounded-lg overflow-hidden max-w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
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
          {/* Show reasoning while thinking, even before content arrives */}
          {message.reasoning ? (
            <ReasoningDisplay 
              reasoning={message.reasoning} 
              isStreaming={true}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex space-x-1">
                <div className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="h-2 w-2 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          )}
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
        className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4 ${!isUser && isResponding && props.isLast ? '' : 'group'} text-neutral-900 dark:text-neutral-200`}
      >
        {/* Edit button for user messages - positioned to the left of the bubble */}
        {isUser && !isEditing && !isResponding && (
          <button
            onClick={handleStartEdit}
            className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-0 group-hover:opacity-100 p-1 mr-1 self-center"
            title="Edit message"
            type="button"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        
        <div
          className={`${
            isUser 
              ? "rounded-lg py-3 px-3 bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-200" 
              : "flex-1 py-3"
          } wrap-break-words overflow-x-auto`}
        >
          {isUser ? (
            isEditing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  ref={textareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full min-w-50 bg-transparent border-none outline-none resize-none font-sans text-neutral-900 dark:text-neutral-200"
                  rows={1}
                />
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={handleCancelEdit}
                    className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors p-1"
                    title="Cancel (Esc)"
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleConfirmEdit}
                    className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors p-1"
                    title="Save (Enter)"
                    type="button"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
            )
          ) : (
            <>
              {/* Show reasoning/thinking tokens if available */}
              {(message.reasoning || (props.isLast && isResponding)) && (
                <ReasoningDisplay 
                  reasoning={message.reasoning || ''} 
                  isStreaming={props.isLast && isResponding && !message.content}
                />
              )}
              {message.content && <Markdown>{message.content}</Markdown>}
            </>
          )}

          {/* Show tool call indicators for assistant messages with tool calls */}
          {!isUser && hasToolCalls && props.isLast && (
            <div className="mt-3 space-y-1">
              {message.toolCalls?.map((toolCall, index) => {
                const preview = getToolCallPreview(toolCall.name, toolCall.arguments);
                const isPendingElicitation = pendingElicitation && pendingElicitation.toolCallId === toolCall.id;
                
                // Show elicitation prompt if this tool call has a pending elicitation
                if (isPendingElicitation) {
                  return (
                    <ElicitationPrompt
                      key={toolCall.id || index}
                      toolName={pendingElicitation.toolName}
                      message={pendingElicitation.elicitation.message}
                      onResolve={resolveElicitation}
                    />
                  );
                }
                
                // Only show loading indicator if actively responding
                if (!isResponding) {
                  return null;
                }
                
                return (
                  <div key={toolCall.id || index} className="rounded-lg overflow-hidden max-w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
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
            <div className={`flex justify-between items-center mt-2 transition-opacity duration-200 ${
              props.isLast && !isResponding ? 'opacity-100!' : 'opacity-0 group-hover:opacity-100'
            }`}>
              <div className="flex items-center gap-2">
                <CopyButton markdown={message.content || ''} className="h-4 w-4" />
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
