import { createContext } from 'react';
import type { Node, NodeChange, EdgeChange, Connection } from '@xyflow/react';
import type { WorkflowEdge } from '../types/workflow';

export interface WorkflowContextType {
  nodes: Node[];
  edges: WorkflowEdge[];
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  updateNode: (id: string, updates: Partial<Node>) => void;
  deleteNode: (id: string) => void;
  deleteConnection: (id: string) => void;
  updateEdgeLabel: (edgeId: string, label: string) => void;
  executeWorkflow: () => Promise<void>;
  clearWorkflow: () => void;
}

export const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);
