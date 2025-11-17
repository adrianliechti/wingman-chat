import { createContext } from 'react';
import type { Bridge } from '../lib/bridge';

export type BridgeContextType = {
  bridge: Bridge;
};

export const BridgeContext = createContext<BridgeContextType | undefined>(undefined);
