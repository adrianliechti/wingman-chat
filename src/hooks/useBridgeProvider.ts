import { useMemo } from 'react';
import { useBridge } from './useBridge';
import type { ToolProvider } from '../types/chat';

export function useBridgeProvider(): ToolProvider | null {
  const { bridge } = useBridge();

  const provider = useMemo<ToolProvider | null>(() => {
    if (!bridge.isConnected()) {
      return null;
    }

    return {
      id: 'bridge',
      name: 'Bridge',
      description: 'Local connected tools',
      instructions: bridge.getInstructions() || undefined,
      tools: async () => bridge.listTools(),
      isEnabled: true,
      isInitializing: false,
      setEnabled: () => {}, // Bridge is always on when connected
    };
  }, [bridge]);

  return provider;
}
