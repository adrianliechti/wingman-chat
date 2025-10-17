import { createContext } from 'react';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';
import type { WorkflowNode, WorkflowEdge } from '../types/workflow';

export interface WorkflowContextType {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, updates: Partial<WorkflowNode>) => void;
  deleteNode: (id: string) => void;
  deleteConnection: (id: string) => void;
  updateEdgeLabel: (edgeId: string, label: string) => void;
  executeWorkflow: () => Promise<void>;
  clearWorkflow: () => void;
}

export const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);
