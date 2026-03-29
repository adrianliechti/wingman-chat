import type { Message } from "@/shared/types/chat";

export interface Notebook {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookSource {
  id: string;
  type: "web" | "file";
  name: string;
  content: string;
  metadata?: {
    url?: string;
    query?: string;
    fileType?: string;
    fileSize?: number;
  };
  addedAt: string;
}

export type OutputType = "audio-overview" | "slide-deck" | "infographic" | "data-table" | "quiz" | "mind-map";

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

export interface NotebookOutput {
  id: string;
  type: OutputType;
  title: string;
  content: string;
  imageUrl?: string;
  slides?: string[];
  audioUrl?: string;
  quiz?: QuizQuestion[];
  mindMap?: MindMapNode;
  status: "generating" | "completed" | "error";
  error?: string;
  createdAt: string;
}

export type NotebookMessage = Message & { timestamp: string };
