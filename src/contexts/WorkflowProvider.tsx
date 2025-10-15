import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNodesState, useEdgesState, addEdge, type Connection, type OnConnect } from '@xyflow/react';
import { WorkflowContext } from './WorkflowContext';
import type { WorkflowNode, WorkflowEdge } from '../types/workflow';

interface WorkflowProviderProps {
  children: ReactNode;
}

export function WorkflowProvider({ children }: WorkflowProviderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);

  const addNode = useCallback((node: WorkflowNode) => {
    setNodes((nds) => [...nds, node]);
  }, [setNodes]);

  const updateNode = useCallback((id: string, updates: Partial<WorkflowNode>) => {
    setNodes((nds) => 
      nds.map((node) => 
        node.id === id ? { ...node, ...updates } as WorkflowNode : node
      )
    );
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== id));
    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id));
  }, [setNodes, setEdges]);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge(connection, eds));
  }, [setEdges]);

  const deleteConnection = useCallback((id: string) => {
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  }, [setEdges]);

  const executeWorkflow = useCallback(async () => {
    // TODO: Implement workflow execution logic
    console.log('Executing workflow with nodes:', nodes);
    console.log('Edges:', edges);
  }, [nodes, edges]);

  const clearWorkflow = useCallback(() => {
    setNodes([]);
    setEdges([]);
  }, [setNodes, setEdges]);

  return (
    <WorkflowContext.Provider
      value={{
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        addNode,
        updateNode,
        deleteNode,
        deleteConnection,
        executeWorkflow,
        clearWorkflow,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
}
