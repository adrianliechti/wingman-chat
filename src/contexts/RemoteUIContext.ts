import { createContext } from 'react';
import { UIResource } from '../hooks/useRemoteUI';

export type RemoteUIContextType = {
  showRemoteUIDrawer: boolean;
  setShowRemoteUIDrawer: (show: boolean) => void;
  toggleRemoteUIDrawer: () => void;
  resource: UIResource | null;
  setResource: (resource: UIResource | null) => void;
};

export const RemoteUIContext = createContext<RemoteUIContextType | undefined>(undefined);
