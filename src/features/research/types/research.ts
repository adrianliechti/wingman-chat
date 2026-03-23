export interface Research {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSource {
  id: string;
  type: 'web' | 'file';
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

export type OutputType =
  | 'audio-overview'
  | 'slide-deck'
  | 'infographic'
  | 'data-table';

export interface ResearchOutput {
  id: string;
  type: OutputType;
  title: string;
  content: string;
  imageUrl?: string;
  slides?: string[];
  audioUrl?: string;
  status: 'generating' | 'completed' | 'error';
  error?: string;
  createdAt: string;
}

import type { Message } from '@/shared/types/chat';

export type ResearchMessage = Message & { timestamp: string };
