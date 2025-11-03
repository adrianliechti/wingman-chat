import type { Node, Edge } from '@xyflow/react';

export type NodeType = 'search' | 'prompt' | 'translate' | 'file' | 'text' | 'repository' | 'markdown' | 'audio' | 'image' | 'csv';

// Base interface that all node data types must extend
// This ensures all nodes have a consistent outputText field for connections
export interface BaseNodeData extends Record<string, unknown> {
  outputText?: string;
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
