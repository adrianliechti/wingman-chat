import { ChangeEvent, useState, FormEvent, useRef, useEffect } from "react";
import { Textarea } from '@headlessui/react'

import { Send, Paperclip, ScreenShare, Image, X } from "lucide-react";

import { Attachment, AttachmentType, Message, Role } from "../models/chat";
import {
  captureScreenshot,
  getFileExt,
  readAsDataURL,
  readAsText,
  resizeImageBlob,
  supportsScreenshot,
} from "../lib/utils";
import {
  partition,
  supportedTypes,
  textTypes,
  partitionTypes,
  imageTypes,
} from "../lib/client";

type ChatInputProps = {
  onSend: (message: Message) => void;
};

export function ChatInput({ onSend }: ChatInputProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textInputRef.current) {
      textInputRef.current.style.height = "auto";
      const newHeight = Math.min(textInputRef.current.scrollHeight, window.innerHeight * 0.2);
      textInputRef.current.style.height = newHeight + "px";
    }
  }, [content]);

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
    }
  };

  const handleAttachmentClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleScreenshotClick = async () => {
    const data = await captureScreenshot();

    const attachment = {
      type: AttachmentType.Image,
      name: "screenshot.png",
      data: data,
    };

    setAttachments((prev) => [...prev, attachment]);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;

    if (files) {
      const newAttachments: Attachment[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (textTypes.includes(file.type) || textTypes.includes(getFileExt(file.name))) {
          const text = await readAsText(file);
          newAttachments.push({
            type: AttachmentType.Text,
            name: file.name,
            data: text,
          });
        }

        if (imageTypes.includes(file.type) || imageTypes.includes(getFileExt(file.name))) {
          const blob = await resizeImageBlob(file, 1920, 1920);
          const url = await readAsDataURL(blob);
          newAttachments.push({
            type: AttachmentType.Image,
            name: file.name,
            data: url,
          });
        }

        if (partitionTypes.includes(file.type) || partitionTypes.includes(getFileExt(file.name))) {
          const parts = await partition(file);
          
          let text = parts.map((part) => part.text).join("\n\n");
          text = text.replace(/[\u0000-\u001F\u007F]/g, "");

          newAttachments.push({
            type: AttachmentType.Text,
            name: file.name,
            data: text,
          });
        }
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
      e.target.value = "";
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[#121212]">
      <div className="flex py-4 px-4 items-center gap-2">
        <input
          type="file"
          multiple
          accept={supportedTypes.join(",")}
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
        />

        <Textarea
          ref={textInputRef}
          className="flex-1 border border-[#3a3a3c] bg-[#2c2c2e] text-[#e5e5e5] rounded px-3 py-2 focus:outline-none max-h-[20vh] overflow-y-auto resize-none"
          placeholder="Ask..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {supportsScreenshot() && (
          <button
            type="button"
            className="p-2 text-[#e5e5e5] hover:text-gray-300 bg-transparent"
            onClick={handleScreenshotClick}
          >
            <ScreenShare size={20} />
          </button>
        )}

        <button
          type="button"
          className="p-2 text-[#e5e5e5] hover:text-gray-300 bg-transparent"
          onClick={handleAttachmentClick}
        >
          <Paperclip size={20} />
        </button>

        <button
          className="p-2 text-[#e5e5e5] hover:text-gray-300 bg-transparent"
          type="submit"
        >
          <Send size={20} />
        </button>
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-4 pr-26">
          {attachments.map((val, i) => (
            <div
              key={i}
              className="flex items-center gap-1 bg-[#2c2c2e] p-2 rounded"
            >
              <Image className="text-[#e5e5e5]" size={16} />
              <span className="text-[#e5e5e5] text-sm break-all">
                {val.name}
              </span>
              <button
                type="button"
                className="text-[#e5e5e5] hover:text-gray-300"
                onClick={() => handleRemoveAttachment(i)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
