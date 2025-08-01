import { useContext } from 'react';
import { RemoteUIContext, RemoteUIContextType } from '../contexts/RemoteUIContext';

export function useRemoteUIContext(): RemoteUIContextType {
  const context = useContext(RemoteUIContext);
  if (context === undefined) {
    throw new Error('useRemoteUIContext must be used within a RemoteUIProvider');
  }
  return context;
}
