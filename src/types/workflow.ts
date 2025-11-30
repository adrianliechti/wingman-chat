import type { Node, Edge } from '@xyflow/react';

// Structured data interface for nodes that produce array results
// Allows nodes to output both formatted text and structured data
export interface DataItem<T = unknown> {
  value: T;           // The actual data item
  text: string;       // Pre-formatted text representation
}

export interface Data<T = unknown> {
  text?: string;           // Optional pre-computed combined text
  items: DataItem<T>[];    // Array of data items
}

// Helper function to get combined text from Data
// Returns the pre-computed text if available, otherwise constructs from items
export function getDataText(data: Data | undefined, separator: string = '\n\n---\n\n'): string {
  if (!data) {
    return '';
  }
  if (data.text !== undefined) {
    return data.text;
  }
  if (data.items.length === 0) {
    return '';
  }
  return data.items.map(item => item.text.trim()).join(separator);
}

// Helper function to create a simple single-item Data from text
export function createData(text: string): Data<string> {
  return {
    items: [{ value: text, text }]
  };
}

// Base interface that all node data types must extend
// Use output for structured data, getDataText() to get combined text
export interface BaseNodeData extends Record<string, unknown> {
  output?: Data;      // Structured output
  error?: string;
}

// Custom edge data for labeled connections
export interface WorkflowEdgeData extends Record<string, unknown> {
  label?: string;
}

// Use ReactFlow's Edge type with custom data for connections
export type WorkflowEdge = Edge<WorkflowEdgeData>;

export interface Workflow {
  id: string;
  name: string;
  nodes: Node[];
  connections: WorkflowEdge[];
  createdAt: Date;
  updatedAt: Date;
}
