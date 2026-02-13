import { useContext } from 'react';
import { BridgeContext } from '@/features/settings/context/BridgeContext';

export function useBridge() {
  const context = useContext(BridgeContext);
  
  if (context === undefined) {
    throw new Error('useBridge must be used within a BridgeProvider');
  }
  
  return context;
}
