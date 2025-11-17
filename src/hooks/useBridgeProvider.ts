import { useMemo } from 'react';
import { useBridge } from './useBridge';
import type { ToolProvider } from '../types/chat';

export function useBridgeProvider(): ToolProvider | null {
  const { bridge } = useBridge();

  const provider = useMemo<ToolProvider | null>(() => {
    if (!bridge.isConnected()) {
      return null;
    }

    return bridge;
  }, [bridge]);

  return provider;
}
