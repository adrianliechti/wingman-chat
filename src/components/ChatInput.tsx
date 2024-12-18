import { ChangeEvent, useState, FormEvent, useRef } from "react";

import { Send, Paperclip, Image, X } from "lucide-react";

import { Attachment, AttachmentType, Message, Role } from "../models/chat";
import { readAsDataURL } from "../lib/utils";
import { partition, partitionTypes } from "../lib/client";

type ChatInputProps = {
  onSend: (message: Message) => void;
};

export function ChatInput({ onSend }: ChatInputProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;

    if (files) {
      const newAttachments: Attachment[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        console.log(file);

        if (file.type.startsWith("image/")) {
          const url = await readAsDataURL(file);
          newAttachments.push({
            type: AttachmentType.Image,
            name: file.name,
            data: url,
          });
        }

        if (partitionTypes.includes(file.type)) {
          const parts = await partition(file);

          const text = parts.map((part) => part.text).join("\n\n");
          
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
          accept={`image/*,${partitionTypes.join(",")}`}
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
        />

        <textarea
          className="flex-1 border border-[#3a3a3c] bg-[#2c2c2e] text-[#e5e5e5] rounded px-3 py-2 focus:outline-none h-10.5 min-h-10.5"
          placeholder="Ask..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
        />

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
