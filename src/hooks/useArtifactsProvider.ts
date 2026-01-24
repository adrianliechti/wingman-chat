import { useCallback, useMemo } from 'react';
import { Table } from 'lucide-react';
import { useArtifacts } from './useArtifacts';
import type { Tool, ToolProvider } from '../types/chat';
import artifactsInstructionsText from '../prompts/artifacts.txt?raw';

export function useArtifactsProvider(): ToolProvider | null {
  const { fs, activeFile, isAvailable } = useArtifacts();

  const artifactsTools = useCallback((): Tool[] => {
    return [
      {
        name: 'create_file',
        description: 'Create a new file or update an existing file in the virtual filesystem with the specified path and content.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path (e.g., /projects/test.go, /src/index.js). Should start with / and include the full directory structure.'
            },
            content: {
              type: 'string',
              description: 'The content of the file to create.'
            }
          },
          required: ['path', 'content']
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizePath(args.path as string);
          const content = args.content as string;

          if (!path || !content) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Path and content are required' }) }];
          }

          try {
            if (!fs) {
              return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
            }
            fs.createFile(path, content);
            return [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              message: `File created: ${path}`,
              path
            }) }];
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to create file' }) }];
          }
        }
      },
      {
        name: 'list_files',
        description: 'List all files in the virtual filesystem, optionally filtered by directory path.',
        parameters: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Optional directory path to filter files (e.g., /src, /components). If not provided, lists all files.'
            }
          },
          required: []
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizePath((args.directory as string) ?? '/');

          if (!fs) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
          }

          try {
            const allFiles = fs.listFiles();
            const filteredFiles = !path || path === '/'
              ? allFiles
              : allFiles.filter(file => file.path.startsWith(path));

            const fileList = filteredFiles.map(file => ({
              path: file.path,
              size: file.content.length,
              contentType: file.contentType
            }));

            return [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              files: fileList,
              count: fileList.length
            }) }];
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to list files' }) }];
          }
        }
      },
      {
        name: 'delete_file',
        description: 'Delete a file or folder from the virtual filesystem. When deleting a folder, all files within it will be deleted.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file or folder path to delete (e.g., /src/index.js or /src/components)'
            }
          },
          required: ['path']
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizePath(args.path as string);

          if (!path) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Path is required' }) }];
          }

          if (!fs) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
          }

          const file = fs.getFile(path);
          const isFolder = fs.listFiles().some(f => f.path.startsWith(path + '/'));

          if (!file && !isFolder) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: `File or folder not found: ${path}` }) }];
          }

          try {
            const success = fs.deleteFile(path);
            if (success) {
              const itemType = file ? 'file' : 'folder';
              return [{ type: 'text' as const, text: JSON.stringify({
                success: true,
                message: `${itemType} deleted: ${path}`,
                path
              }) }];
            } else {
              return [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to delete: ${path}` }) }];
            }
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to delete item' }) }];
          }
        }
      },
      {
        name: 'move_file',
        description: 'Move or rename a file in the virtual filesystem from one path to another.',
        parameters: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'The source file path (e.g., /src/old-name.js)'
            },
            to: {
              type: 'string',
              description: 'The destination file path (e.g., /src/new-name.js)'
            }
          },
          required: ['from', 'to']
        },
        function: async (args: Record<string, unknown>) => {
          const fromPath = normalizePath(args.from as string);
          const toPath = normalizePath(args.to as string);

          if (!fromPath || !toPath) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Both from and to path are required' }) }];
          }

          if (!fs) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
          }

          const sourceFile = fs.getFile(fromPath);
          if (!sourceFile) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: `Source file not found: ${fromPath}` }) }];
          }

          const destFile = fs.getFile(toPath);
          if (destFile) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: `Destination file already exists: ${toPath}` }) }];
          }

          try {
            const success = fs.renameFile(fromPath, toPath);

            if (!success) {
              return [{ type: 'text' as const, text: JSON.stringify({
                error: `Failed to move file from ${fromPath} to ${toPath}. Source may not exist or destination already exists.`
              }) }];
            }

            return [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              message: `File moved from ${fromPath} to ${toPath}`,
              fromPath,
              toPath
            }) }];
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to move file' }) }];
          }
        }
      },
      {
        name: 'read_file',
        description: 'Read the content of a specific file from the virtual filesystem.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to read (e.g., /src/index.js)'
            }
          },
          required: ['path']
        },
        function: async (args: Record<string, unknown>) => {
          const path = normalizePath(args.path as string);

          if (!path) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Path is required' }) }];
          }

          if (!fs) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
          }

          const file = fs.getFile(path);

          if (!file) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: `File not found: ${path}` }) }];
          }

          try {
            const fileInfo = {
              path,
              size: file.content.length,
              content: file.content,
              contentType: file.contentType,
            };

            return [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              file: fileInfo
            }) }];
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to read file content' }) }];
          }
        }
      },
      {
        name: 'current_path',
        description: 'Get the file path of the currently opened file in the artifacts editor.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        function: async () => {
          if (!fs) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
          }

          try {
            if (!activeFile) {
              return [{ type: 'text' as const, text: JSON.stringify({
                success: true,
                message: 'No file is currently active',
                currentPath: null
              }) }];
            }

            return [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              currentPath: activeFile
            }) }];
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to get current path' }) }];
          }
        }
      },
      {
        name: 'current_file',
        description: 'Get the file path and content of the currently opened file in the artifacts editor.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        function: async () => {
          if (!fs) {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'File system not available' }) }];
          }

          try {
            if (!activeFile) {
              return [{ type: 'text' as const, text: JSON.stringify({
                success: true,
                message: 'No file is currently active',
                currentFile: null
              }) }];
            }
            const file = fs.getFile(activeFile);

            if (!file) {
              return [{ type: 'text' as const, text: JSON.stringify({
                error: `Active file not found: ${activeFile}`
              }) }];
            }

            const fileInfo = {
              path: file.path,
              size: file.content.length,
              content: file.content,
              contentType: file.contentType,
            };

            return [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              currentFile: fileInfo
            }) }];
          } catch {
            return [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to get current file info' }) }];
          }
        }
      }
    ];
  }, [fs, activeFile]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "artifacts",
      name: "Artifacts",
      description: "Create and edit files",
      icon: Table,
      instructions: artifactsInstructionsText,
      tools: artifactsTools(),
    };
  }, [isAvailable, artifactsTools]);

  return provider;
}

function normalizePath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  // Remove leading/trailing whitespace
  let normalized = path.trim();

  if (!normalized) {
    return undefined;
  }

  // Ensure path starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, '/');

  // Remove trailing slash unless it's the root
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}