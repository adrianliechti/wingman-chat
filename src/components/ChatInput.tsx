import { ChangeEvent, useState, FormEvent, useRef, useEffect } from "react";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'

import { Send, Paperclip, ScreenShare, Image, X, Brain, Link, File, Loader2, FileText } from "lucide-react";

import { Attachment, AttachmentType, Message, Role, Model, Tool } from "../models/chat";
import {
  captureScreenshot,
  getFileExt,
  readAsDataURL,
  readAsText,
  resizeImageBlob,
  supportsScreenshot,
  supportedTypes,
  textTypes,
  imageTypes,
  documentTypes,
} from "../lib/utils";
import { getConfig } from "../config";

type ChatInputProps = {
  onSend: (message: Message) => void;
  models: Model[];
  currentModel: Model | undefined;
  onModelChange: (model: Model) => void;
};

export function ChatInput({ onSend, models, currentModel, onModelChange }: ChatInputProps) {
  const config = getConfig();
  const client = config.client;
  const bridge = config.bridge;

  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState<Set<string>>(new Set());
  const [bridgeTools, setBridgeTools] = useState<Tool[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);

  // Helper function to get the appropriate icon for each attachment type
  const getAttachmentIcon = (attachment: Attachment) => {
    switch (attachment.type) {
      case AttachmentType.Image:
        return <Image size={24} />;
      case AttachmentType.Text:
        return <FileText size={24} />;
      case AttachmentType.File:
        return <File size={24} />;
      default:
        return <File size={24} />;
    }
  };

  // Fetch bridge tools when bridge is connected
  useEffect(() => {
    const fetchTools = async () => {
      if (bridge.isConnected()) {
        try {
          const tools = await bridge.listTools();
          setBridgeTools(tools);
        } catch (error) {
          console.error("Failed to fetch bridge tools:", error);
          setBridgeTools([]);
        }
      } else {
        setBridgeTools([]);
      }
    };

    fetchTools();
    
    const interval = setInterval(fetchTools, 5000);    
    return () => clearInterval(interval);
  }, [bridge]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (content.trim()) {
      const message: Message = {
        role: Role.User,
        content: content,
        attachments: attachments,
      };

      onSend(message);
      setContent("");
      setAttachments([]);
      
      if (contentEditableRef.current) {
        contentEditableRef.current.textContent = "";
      }
    }
  };

  const handleAttachmentClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleScreenshotClick = async () => {
    const screenshotId = `screenshot-${Date.now()}`;
    setLoadingAttachments(prev => new Set([...prev, screenshotId]));
    
    try {
      const data = await captureScreenshot();

      const attachment = {
        type: AttachmentType.Image,
        name: "screenshot.png",
        data: data,
      };

      setAttachments((prev) => [...prev, attachment]);
    } catch (error) {
      console.error("Error capturing screenshot:", error);
    } finally {
      setLoadingAttachments(prev => {
        const newSet = new Set(prev);
        newSet.delete(screenshotId);
        return newSet;
      });
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;

    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileId = `${file.name}-${Date.now()}-${i}`;
        
        // Add to loading state
        setLoadingAttachments(prev => new Set([...prev, fileId]));
        
        try {
          let attachment: Attachment | null = null;

          if (textTypes.includes(file.type) || textTypes.includes(getFileExt(file.name))) {
            const text = await readAsText(file);
            attachment = {
              type: AttachmentType.Text,
              name: file.name,
              data: text,
            };
          }

          if (imageTypes.includes(file.type) || imageTypes.includes(getFileExt(file.name))) {
            const blob = await resizeImageBlob(file, 1920, 1920);
            const url = await readAsDataURL(blob);
            attachment = {
              type: AttachmentType.Image,
              name: file.name,
              data: url,
            };
          }

          if (documentTypes.includes(file.type) || documentTypes.includes(getFileExt(file.name))) {
            const text = await client.extractText(file);
            attachment = {
              type: AttachmentType.Text,
              name: file.name,
              data: text,
            };
          }

          if (attachment) {
            setAttachments((prev) => [...prev, attachment!]);
          }
        } catch (error) {
          console.error("Error processing file:", error);
        } finally {
          // Remove from loading state
          setLoadingAttachments(prev => {
            const newSet = new Set(prev);
            newSet.delete(fileId);
            return newSet;
          });
        }
      }

      e.target.value = "";
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="border border-neutral-300 dark:border-neutral-700 bg-neutral-200 dark:bg-neutral-800 rounded-lg md:rounded-2xl flex flex-col min-h-[3rem] shadow-2xl shadow-black/60 dark:shadow-black/80 drop-shadow-2xl">
        <input
          type="file"
          multiple
          accept={supportedTypes.join(",")}
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Attachments display at the top of the input */}
        {(attachments.length > 0 || loadingAttachments.size > 0) && (
          <div className="flex flex-wrap gap-3 p-3">
            {/* Loading attachments */}
            {Array.from(loadingAttachments).map((fileId, index) => (
              <div
                key={fileId}
                className="relative w-14 h-14 bg-neutral-100 dark:bg-neutral-700 rounded-xl border-2 border-dashed border-neutral-400 dark:border-neutral-500 flex items-center justify-center animate-pulse"
                title="Processing file..."
              >
                <Loader2 size={18} className="animate-spin text-neutral-500 dark:text-neutral-400" />
                {loadingAttachments.size > 1 && (
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center">
                    {index + 1}
                  </div>
                )}
              </div>
            ))}
            
            {/* Processed attachments */}
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="relative w-14 h-14 bg-white dark:bg-neutral-600 rounded-xl border border-neutral-300 dark:border-neutral-500 shadow-sm flex items-center justify-center group hover:shadow-md hover:border-neutral-400 dark:hover:border-neutral-400 transition-all duration-200"
                title={attachment.name}
              >
                {attachment.type === AttachmentType.Image ? (
                  <img 
                    src={attachment.data} 
                    alt={attachment.name}
                    className="w-full h-full object-cover rounded-xl"
                  />
                ) : (
                  <div className="text-neutral-600 dark:text-neutral-300">
                    {getAttachmentIcon(attachment)}
                  </div>
                )}
                <button
                  type="button"
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-neutral-800/80 hover:bg-neutral-900 dark:bg-neutral-200/80 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm shadow-sm cursor-pointer"
                  onClick={() => handleRemoveAttachment(index)}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          ref={contentEditableRef}
          className="pt-2 px-2 pb-2 md:pt-4 md:px-4 md:pb-2 pr-0 bg-transparent dark:text-neutral-200 focus:outline-none flex-1 max-h-[40vh] overflow-y-auto min-h-[2.5rem] whitespace-pre-wrap break-words empty:before:content-[attr(data-placeholder)] empty:before:text-neutral-500 empty:before:dark:text-neutral-400"
          style={{ scrollbarWidth: "thin" }}
          role="textbox"
          contentEditable
          suppressContentEditableWarning={true}
          data-placeholder="Ask anything"
          onInput={(e) => {
            const target = e.target as HTMLDivElement;
            setContent(target.textContent || "");
          }}
          onKeyDown={handleKeyDown}
        />

        <div className="flex items-center justify-between gap-1 px-2 pb-2 md:px-4 md:pb-2 pt-0">
          <div className="flex items-center gap-2">
            <Menu>
              <MenuButton className="inline-flex items-center gap-1 pl-0 pr-1.5 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none focus:ring-0 focus:border-none text-sm">
                <Brain size={14} />
                <span>
                  {currentModel?.name ?? currentModel?.id ?? "Select Model"}
                </span>
              </MenuButton>
              <MenuItems
                transition
                anchor="bottom start"
                className="sidebar-scroll !max-h-[50vh] mt-2 rounded border bg-neutral-200 dark:bg-neutral-900 border-neutral-700 overflow-y-auto shadow-lg z-50"
              >
                {models.map((model) => (
                  <MenuItem key={model.id}>
                    <Button
                      onClick={() => onModelChange(model)}
                      title={model.description}
                      className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-300 dark:text-neutral-200 dark:data-[focus]:bg-[#2c2c2e] cursor-pointer focus:outline-none focus:ring-0"
                    >
                      {model.name ?? model.id}
                    </Button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
            
            {bridge.isConnected() && (
              <div 
                className="inline-flex items-center gap-1 pl-0 pr-1.5 py-1.5 text-neutral-600 dark:text-neutral-400 text-sm relative group"
                title={bridgeTools.length > 0 ? `Available tools: ${bridgeTools.map(t => t.name).join(', ')}` : "Bridge connected"}
              >
                <Link size={14} />
                <span>Bridge</span>
                {bridgeTools.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-neutral-800 dark:bg-neutral-700 text-white text-xs rounded-md p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                    <div className="font-semibold mb-1">Available Tools ({bridgeTools.length}):</div>
                    <div className="space-y-1">
                      {bridgeTools.map((tool, index) => (
                        <div key={index} className="flex flex-col">
                          <span className="font-medium">{tool.name}</span>
                          {tool.description && (
                            <span className="text-neutral-300 dark:text-neutral-400 text-xs truncate" title={tool.description}>
                              {tool.description}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {supportsScreenshot() && (
              <Button
                type="button"
                className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
                onClick={handleScreenshotClick}
              >
                <ScreenShare size={16} />
              </Button>
            )}

            <Button
              type="button"
              className="p-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
              onClick={handleAttachmentClick}
            >
              <Paperclip size={16} />
            </Button>

            <Button
              className="pl-1.5 pr-0 py-1.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 cursor-pointer focus:outline-none"
              type="submit"
            >
              <Send size={16} />
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
