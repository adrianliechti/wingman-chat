import { useContext, useCallback } from 'react';
import { ArtifactsContext, ArtifactsContextType } from '../contexts/ArtifactsContext';
import { Tool } from '../types/chat';

export interface ArtifactsHook extends ArtifactsContextType {
  artifactsTools: () => Tool[];
}

export function useArtifacts(): ArtifactsHook {
  const context = useContext(ArtifactsContext);
  
  if (!context) {
    throw new Error('useArtifacts must be used within an ArtifactsProvider');
  }

  const {
    filesystem,
    createFile,
    deleteFile,
    activeTab,
  } = context;

  const artifactsTools = useCallback((): Tool[] => {
    return [
      {
        name: 'create_file',
        description: 'Create a new file in the virtual filesystem with the specified path and content.',
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
        function: async (args: Record<string, unknown>): Promise<string> => {
          const path = args.path as string;
          const content = args.content as string;

          console.log(`📄 Creating file: ${path}`);

          if (!path || !content) {
            return JSON.stringify({ error: 'Path and content are required' });
          }

          // Validate path format
          if (!path.startsWith('/')) {
            return JSON.stringify({ error: 'Path must start with /' });
          }

          try {
            // Convert string content to Blob
            const blob = new Blob([content], { type: 'text/plain' });
            createFile(path, blob);
            console.log(`✅ File created successfully: ${path}`);
            return JSON.stringify({ 
              success: true, 
              message: `File created: ${path}`,
              path 
            });
          } catch (error) {
            console.error('❌ Failed to create file:', error);
            return JSON.stringify({ error: 'Failed to create file' });
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
        function: async (args: Record<string, unknown>): Promise<string> => {
          const directory = args.directory as string | undefined;

          console.log(`📋 Listing files${directory ? ` in directory: ${directory}` : ''}`);

          try {
            const allFiles = Object.keys(filesystem);
            const filteredFiles = directory 
              ? allFiles.filter(path => path.startsWith(directory))
              : allFiles;

            const fileList = filteredFiles.map(path => {
              const file = filesystem[path];
              return {
                path,
                size: file.content.size,
                createdAt: file.createdAt.toISOString(),
                updatedAt: file.updatedAt.toISOString()
              };
            });

            console.log(`✅ Found ${fileList.length} files`);
            return JSON.stringify({ 
              success: true, 
              files: fileList,
              count: fileList.length
            });
          } catch (error) {
            console.error('❌ Failed to list files:', error);
            return JSON.stringify({ error: 'Failed to list files' });
          }
        }
      },
      {
        name: 'delete_file',
        description: 'Delete a file from the virtual filesystem.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to delete (e.g., /src/index.js)'
            }
          },
          required: ['path']
        },
        function: async (args: Record<string, unknown>): Promise<string> => {
          const path = args.path as string;

          console.log(`🗑️ Deleting file: ${path}`);

          if (!path) {
            return JSON.stringify({ error: 'Path is required' });
          }

          if (!filesystem[path]) {
            return JSON.stringify({ error: `File not found: ${path}` });
          }

          try {
            deleteFile(path);
            console.log(`✅ File deleted successfully: ${path}`);
            return JSON.stringify({ 
              success: true, 
              message: `File deleted: ${path}`,
              path 
            });
          } catch (error) {
            console.error('❌ Failed to delete file:', error);
            return JSON.stringify({ error: 'Failed to delete file' });
          }
        }
      },
      {
        name: 'move_file',
        description: 'Move or rename a file in the virtual filesystem.',
        parameters: {
          type: 'object',
          properties: {
            fromPath: {
              type: 'string',
              description: 'The current file path (e.g., /src/old.js)'
            },
            toPath: {
              type: 'string',
              description: 'The new file path (e.g., /src/new.js)'
            }
          },
          required: ['fromPath', 'toPath']
        },
        function: async (args: Record<string, unknown>): Promise<string> => {
          const fromPath = args.fromPath as string;
          const toPath = args.toPath as string;

          console.log(`📁 Moving file from ${fromPath} to ${toPath}`);

          if (!fromPath || !toPath) {
            return JSON.stringify({ error: 'Both fromPath and toPath are required' });
          }

          if (!filesystem[fromPath]) {
            return JSON.stringify({ error: `Source file not found: ${fromPath}` });
          }

          if (filesystem[toPath]) {
            return JSON.stringify({ error: `Destination file already exists: ${toPath}` });
          }

          // Validate toPath format
          if (!toPath.startsWith('/')) {
            return JSON.stringify({ error: 'Destination path must start with /' });
          }

          try {
            const file = filesystem[fromPath];
            
            // Create new file at destination
            createFile(toPath, file.content);
            
            // Delete original file
            deleteFile(fromPath);

            console.log(`✅ File moved successfully from ${fromPath} to ${toPath}`);
            return JSON.stringify({ 
              success: true, 
              message: `File moved from ${fromPath} to ${toPath}`,
              fromPath,
              toPath
            });
          } catch (error) {
            console.error('❌ Failed to move file:', error);
            return JSON.stringify({ error: 'Failed to move file' });
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
        function: async (args: Record<string, unknown>): Promise<string> => {
          const path = args.path as string;

          console.log(`📖 Reading file: ${path}`);

          if (!path) {
            return JSON.stringify({ error: 'Path is required' });
          }

          const file = filesystem[path];
          if (!file) {
            return JSON.stringify({ error: `File not found: ${path}` });
          }

          try {
            // Read the blob content as text
            const textContent = await file.content.text();

            const fileInfo = {
              path,
              size: file.content.size,
              type: file.content.type,
              createdAt: file.createdAt.toISOString(),
              updatedAt: file.updatedAt.toISOString(),
              content: textContent
            };

            console.log(`✅ File read successfully: ${path} (${file.content.size} bytes)`);
            return JSON.stringify({ 
              success: true, 
              file: fileInfo
            });
          } catch (error) {
            console.error('❌ Failed to read file:', error);
            return JSON.stringify({ error: 'Failed to read file content' });
          }
        }
      },
      {
        name: 'current_path',
        description: 'Get the path of the currently active file in the artifacts drawer.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        function: async (): Promise<string> => {
          console.log(`📍 Getting current file path`);

          try {
            if (!activeTab) {
              return JSON.stringify({ 
                success: true,
                message: 'No file is currently active',
                currentPath: null
              });
            }

            console.log(`✅ Current file path: ${activeTab}`);
            return JSON.stringify({ 
              success: true, 
              currentPath: activeTab
            });
          } catch (error) {
            console.error('❌ Failed to get current path:', error);
            return JSON.stringify({ error: 'Failed to get current path' });
          }
        }
      },
      {
        name: 'current_file',
        description: 'Get information about the currently active file in the artifacts drawer.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        function: async (): Promise<string> => {
          console.log(`📋 Getting current file info`);

          try {
            if (!activeTab) {
              return JSON.stringify({ 
                success: true,
                message: 'No file is currently active',
                currentFile: null
              });
            }

            const file = filesystem[activeTab];
            if (!file) {
              return JSON.stringify({ 
                error: `Active file not found: ${activeTab}` 
              });
            }

            // Read the blob content as text
            const textContent = await file.content.text();

            const fileInfo = {
              path: activeTab,
              size: file.content.size,
              type: file.content.type,
              createdAt: file.createdAt.toISOString(),
              updatedAt: file.updatedAt.toISOString(),
              content: textContent
            };

            console.log(`✅ Current file: ${activeTab} (${file.content.size} bytes)`);
            return JSON.stringify({ 
              success: true, 
              currentFile: fileInfo
            });
          } catch (error) {
            console.error('❌ Failed to get current file:', error);
            return JSON.stringify({ error: 'Failed to get current file info' });
          }
        }
      }
    ];
  }, [filesystem, createFile, deleteFile, activeTab]);
  
  return {
    ...context,
    artifactsTools,
  };
}
