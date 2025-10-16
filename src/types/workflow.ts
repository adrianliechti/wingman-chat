import type { Node, Edge } from '@xyflow/react';

export type NodeType = 'searchInput' | 'llm' | 'translate' | 'fileInput' | 'webInput' | 'textInput' | 'markdownOutput' | 'audioOutput' | 'imageOutput' | 'csvOutput';

// Custom data for each node type
export interface SearchInputNodeData extends Record<string, unknown> {
  inputText?: string;
  outputText?: string;
  useInput: boolean; // true if connected to another node, false if using fixed text
}

export interface LLMNodeData extends Record<string, unknown> {
  inputText?: string;
  outputText?: string;
  useInput: boolean; // true if connected to another node, false if using fixed text
  prompt?: string;
}

export interface TranslateNodeData extends Record<string, unknown> {
  outputText?: string;
  useInput: boolean;
  language?: string;
  tone?: string;
  style?: string;
}

export interface FileInputNodeData extends Record<string, unknown> {
  fileName?: string;
  fileContent?: string;
  outputText?: string;
  useInput: boolean;
}

export interface WebInputNodeData extends Record<string, unknown> {
  url?: string;
  outputText?: string;
  useInput: boolean;
}

export interface TextInputNodeData extends Record<string, unknown> {
  content?: string;
  useInput: boolean;
}

export interface MarkdownOutputNodeData extends Record<string, unknown> {
  inputText?: string;
  outputText?: string;
  error?: string;
  useInput: boolean;
}

export interface AudioOutputNodeData extends Record<string, unknown> {
  audioUrl?: string;
  error?: string;
  useInput: boolean;
}

export interface ImageOutputNodeData extends Record<string, unknown> {
  imageUrl?: string;
  error?: string;
  useInput: boolean;
}

export interface CsvOutputNodeData extends Record<string, unknown> {
  csvData?: string;
  error?: string;
  useInput: boolean;
}

// ReactFlow node types with custom data
export type SearchInputNode = Node<SearchInputNodeData, 'searchInput'>;
export type LLMNode = Node<LLMNodeData, 'llm'>;
export type TranslateNode = Node<TranslateNodeData, 'translate'>;
export type FileInputNode = Node<FileInputNodeData, 'fileInput'>;
export type WebInputNode = Node<WebInputNodeData, 'webInput'>;
export type TextInputNode = Node<TextInputNodeData, 'textInput'>;
export type MarkdownOutputNode = Node<MarkdownOutputNodeData, 'markdownOutput'>;
export type AudioOutputNode = Node<AudioOutputNodeData, 'audioOutput'>;
export type ImageOutputNode = Node<ImageOutputNodeData, 'imageOutput'>;
export type CsvOutputNode = Node<CsvOutputNodeData, 'csvOutput'>;

export type WorkflowNode = SearchInputNode | LLMNode | TranslateNode | FileInputNode | WebInputNode | TextInputNode | MarkdownOutputNode | AudioOutputNode | ImageOutputNode | CsvOutputNode;

// Use ReactFlow's Edge type for connections
export type WorkflowEdge = Edge;

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowEdge[];
  createdAt: Date;
  updatedAt: Date;
}
