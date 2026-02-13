// Config
export { loadConfig, getConfig } from './config';

// Hooks
export { useAutoScroll } from './hooks/useAutoScroll';
export { useDropZone } from './hooks/useDropZone';
export { usePersistedState } from './hooks/usePersistedState';
export type { UsePersistedStateOptions, UsePersistedStateReturn } from './hooks/usePersistedState';

// UI Components
export { CodeRenderer } from './ui/CodeRenderer';
export { ContentRenderer, RenderContents } from './ui/ContentRenderer';
export { ConvertButton } from './ui/ConvertButton';
export { CopyButton } from './ui/CopyButton';
export { DownloadButton } from './ui/DownloadButton';
export { FileIcon } from './ui/FileIcon';
export type { FileIconProps } from './ui/FileIcon';
export { InteractiveText } from './ui/InteractiveText';
export { Markdown } from './ui/Markdown';
export { MediaPlayer } from './ui/MediaPlayer';
export { PlayButton } from './ui/PlayButton';
export { PreviewButton } from './ui/PreviewButton';
export { RewritePopover } from './ui/RewritePopover';

// Types - Chat
export type {
  ToolIcon,
  ModelType,
  Model,
  MCP,
  ToolProvider,
  Tool,
  Elicitation,
  ElicitationResult,
  PendingElicitation,
  ToolContext,
  ReasoningContent,
  ToolCallContent,
  ToolResultContent,
  Content,
  TextContent,
  ImageContent,
  AudioContent,
  FileContent,
  Message,
  MessageError,
  Chat,
} from './types/chat';
export { ProviderState, Role, getTextFromContent } from './types/chat';

// Lib - Client
export { Client } from './lib/client';

// Lib - Models
export { modelType, modelName } from './lib/models';

// Lib - Copy
export type { CopyOptions } from './lib/copy';
export { copyToClipboard } from './lib/copy';

// Lib - DB
export { openDB, closeDB, setValue, getValue, deleteValue, clearDB, getStorageUsage } from './lib/db';

// Lib - Document conversion
export { docxToMarkdown } from './lib/docx';
export { markdownToDocx } from './lib/markdownToDocx';
export { pptxToMarkdown } from './lib/pptx';
export { xlsxToCsv, downloadCsv } from './lib/xlsx';

// Lib - Text utilities
export { splitLines, getLineRange, formatLineOutput } from './lib/text-utils';

// Lib - Utils
export {
  parseDataUrl,
  serializeToolResultForApi,
  lookupContentType,
  readAsText,
  readAsDataURL,
  decodeDataURL,
  resizeImageBlob,
  getFileName,
  getFileExt,
  isAudioUrl,
  isVideoUrl,
  formatBytes,
  markdownToHtml,
  markdownToText,
  downloadFromUrl,
  downloadBlob,
  filenameFromUrl,
  simplifyMarkdown,
} from './lib/utils';

// Lib - OPFS (Origin Private File System)
export {
  getRoot,
  getDirectory,
  writeJson,
  writeText,
  writeBlob,
  readJson,
  readText,
  readBlob,
  deleteFile,
  fileExists,
  listFiles,
  listDirectories,
  deleteDirectory,
  clearAll,
  readIndex,
  writeIndex,
  upsertIndexEntry,
  removeIndexEntry,
  rebuildIndex,
  getStorageUsage as getOPFSStorageUsage,
  storeChatBlob,
  getChatBlob,
  deleteChatBlob,
  listChatBlobs,
  storeBlob,
  getBlob,
  deleteBlob,
  writeArtifact,
  readArtifact,
  deleteArtifact,
  deleteArtifactFolder,
  listArtifacts,
  loadArtifacts,
  saveArtifacts,
  dataUrlToBlob,
  blobToDataUrl,
  isDataUrl,
  isBlobRef,
  createBlobRef,
  parseBlobRef,
  extractMessageBlobsForChat,
  rehydrateMessageBlobsForChat,
  extractChatBlobs,
  rehydrateChatBlobs,
  collectChatBlobIds,
  saveSkill,
  loadSkill,
  deleteSkill,
  listSkillNames,
  loadAllSkills,
  exportFolderAsZip,
  importFolderFromZip,
  rebuildFolderIndex,
  downloadFolderAsZip,
} from './lib/opfs';
export type {
  IndexEntry,
  StorageEntry,
  StorageUsage,
  BlobRefImageContent,
  BlobRefAudioContent,
  BlobRefFileContent,
  StoredContent,
  StoredMessage,
  StoredChat,
  StoredSkill,
} from './lib/opfs';
