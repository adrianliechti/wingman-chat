import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

import { Image, Paperclip, ScreenShare, Send, X } from "lucide-react";

import {
  imageTypes,
  partition,
  partitionTypes,
  supportedTypes,
  textTypes,
} from "../lib/client";
import {
  captureScreenshot,
  getFileExt,
  readAsDataURL,
  readAsText,
  resizeImageBlob,
  supportsScreenshot,
} from "../lib/utils";
import { Attachment, AttachmentType, Message, Role } from "../models/chat";

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
      const newHeight = Math.min(
        textInputRef.current.scrollHeight,
        window.innerHeight * 0.4
      );
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

        if (
          textTypes.includes(file.type) ||
          textTypes.includes(getFileExt(file.name))
        ) {
          const text = await readAsText(file);
          newAttachments.push({
            type: AttachmentType.Text,
            name: file.name,
            data: text,
          });
        }

        if (
          imageTypes.includes(file.type) ||
          imageTypes.includes(getFileExt(file.name))
        ) {
          const blob = await resizeImageBlob(file, 1920, 1920);
          const url = await readAsDataURL(blob);
          newAttachments.push({
            type: AttachmentType.Image,
            name: file.name,
            data: url,
          });
        }

        if (
          partitionTypes.includes(file.type) ||
          partitionTypes.includes(getFileExt(file.name))
        ) {
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
    <form onSubmit={handleSubmit} className="p-2 w-3xl rounded-3xl bg-sidebar">
      <div className="flex items-center gap-1 py-2">
        <input
          type="file"
          multiple
          accept={supportedTypes.join(",")}
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
        />

        <textarea
          ref={textInputRef}
          className="flex-1 borderrounded px-3 py-2 focus:outline-none max-h-[40vh] overflow-y-auto resize-none"
          style={{ scrollbarWidth: "thin" }}
          placeholder="Ask me anything..."
          value={content}
          rows={1}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {supportsScreenshot() && (
          <button
            type="button"
            className="p-2 bg-transparent hover:text-gray-300"
            onClick={handleScreenshotClick}
          >
            <ScreenShare size={20} />
          </button>
        )}

        <button
          type="button"
          className="p-2 bg-transparent hover:text-gray-300"
          onClick={handleAttachmentClick}
        >
          <Paperclip size={20} />
        </button>

        <button
          className="p-2 bg-transparent hover:text-gray-300"
          type="submit"
        >
          <Send size={20} />
        </button>
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mr-30">
          {attachments.map((val, i) => (
            <div key={i} className="flex items-center gap-1 p-2 rounded">
              <Image className="text-[#e5e5e5]" size={16} />
              <span className="text-[#e5e5e5] break-all">{val.name}</span>
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
