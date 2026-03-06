// Components
export { ArtifactsBrowser } from './components/ArtifactsBrowser';
export { ArtifactsDrawer } from './components/ArtifactsDrawer';

// Context
export { ArtifactsContext } from './context/ArtifactsContext';
export type { ArtifactsContextType } from './context/ArtifactsContext';
export { ArtifactsProvider } from './context/ArtifactsProvider';

// Hooks
export { useArtifacts } from './hooks/useArtifacts';
export { useArtifactsProvider } from './hooks/useArtifactsProvider';

// Lib
export type { ArtifactKind, ProcessedFile, TransformResult } from './lib/artifacts';
export { processUploadedFile, artifactLanguage, artifactKind, transformHtmlForPreview } from './lib/artifacts';
export { FileSystemManager, downloadFilesystemAsZip } from './lib/fs';

// Types
export type { File, FileSystem } from './types/file';
