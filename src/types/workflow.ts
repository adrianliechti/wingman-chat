import type { Node, Edge } from '@xyflow/react';

export type NodeType = 'search' | 'prompt' | 'translate' | 'file' | 'text' | 'repository' | 'markdown' | 'audio' | 'image' | 'csv';

// Custom data for each node type
export interface SearchNodeData extends Record<string, unknown> {
  inputText?: string;
  outputText?: string;
  useInput: boolean; // true if connected to another node, false if using fixed text
}

export interface LLMNodeData extends Record<string, unknown> {
  inputText?: string;
  outputText?: string;
  useInput: boolean; // true if connected to another node, false if using fixed text
  prompt?: string;
  model?: string;
}

export interface TranslateNodeData extends Record<string, unknown> {
  outputText?: string;
  useInput: boolean;
  language?: string;
  tone?: string;
  style?: string;
}

export interface FileNodeData extends Record<string, unknown> {
  fileName?: string;
  fileContent?: string;
  outputText?: string;
  useInput: boolean;
}

export interface TextNodeData extends Record<string, unknown> {
  content?: string;
  useInput: boolean;
}

export interface RepositoryNodeData extends Record<string, unknown> {
  repositoryId?: string;
  query?: string;
  outputText?: string;
  useInput: boolean;
}

export interface MarkdownNodeData extends Record<string, unknown> {
  inputText?: string;
  outputText?: string;
  error?: string;
  useInput: boolean;
}

export interface AudioNodeData extends Record<string, unknown> {
  audioUrl?: string;
  error?: string;
  useInput: boolean;
}

export interface ImageNodeData extends Record<string, unknown> {
  imageUrl?: string;
  error?: string;
  useInput: boolean;
}

export interface CsvNodeData extends Record<string, unknown> {
  csvData?: string;
  error?: string;
  useInput: boolean;
}

// ReactFlow node types with custom data
export type SearchNode = Node<SearchNodeData, 'search'>;
export type LLMNode = Node<LLMNodeData, 'prompt'>;
export type TranslateNode = Node<TranslateNodeData, 'translate'>;
export type FileNode = Node<FileNodeData, 'file'>;
export type TextNode = Node<TextNodeData, 'text'>;
export type RepositoryNode = Node<RepositoryNodeData, 'repository'>;
export type MarkdownNode = Node<MarkdownNodeData, 'markdown'>;
export type AudioNode = Node<AudioNodeData, 'audio'>;
export type ImageNode = Node<ImageNodeData, 'image'>;
export type CsvNode = Node<CsvNodeData, 'csv'>;

export type WorkflowNode = SearchNode | LLMNode | TranslateNode | FileNode | TextNode | RepositoryNode | MarkdownNode | AudioNode | ImageNode | CsvNode;

// Custom edge data for labeled connections
export interface WorkflowEdgeData extends Record<string, unknown> {
  label?: string;
}

// Use ReactFlow's Edge type with custom data for connections
export type WorkflowEdge = Edge<WorkflowEdgeData>;

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowEdge[];
  createdAt: Date;
  updatedAt: Date;
}
