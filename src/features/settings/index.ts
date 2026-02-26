// Components
export { SettingsButton } from './components/SettingsButton';
export { SettingsDrawer } from './components/SettingsDrawer';

// Context
export { BridgeContext } from './context/BridgeContext';
export type { BridgeServer, BridgeContextType } from './context/BridgeContext';
export { BridgeProvider } from './context/BridgeProvider';
export { ProfileContext } from './context/ProfileContext';
export type { ProfileSettings, ProfileContextType } from './context/ProfileContext';
export { ProfileProvider } from './context/ProfileProvider';

// Hooks
export { useBridge } from './hooks/useBridge';
export { useBridgeProvider } from './hooks/useBridgeProvider';
export { useProfile } from './hooks/useProfile';
export { useSettings } from './hooks/useSettings';

// Lib
export type { PersonaKey } from './lib/personas';
export { personas, personaOptions, getPersonaContent } from './lib/personas';
export { MCPClient } from './lib/mcp';
export { isMigrationComplete, runMigration } from './lib/migration';
