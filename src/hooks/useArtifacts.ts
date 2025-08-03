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
    fs,
    activeFile,
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
            if (!fs) {
              return JSON.stringify({ error: 'File system not available' });
            }
            fs.createFile(path, content);
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
            if (!fs) {
              return JSON.stringify({ error: 'File system not available' });
            }
            const allFiles = fs.listFiles();
            const filteredFiles = directory 
              ? allFiles.filter(file => file.path.startsWith(directory))
              : allFiles;

            const fileList = filteredFiles.map(file => ({
              path: file.path,
              size: file.content.length,
              contentType: file.contentType,
              createdAt: file.createdAt.toISOString(),
              updatedAt: file.updatedAt.toISOString()
            }));

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
        function: async (args: Record<string, unknown>): Promise<string> => {
          const path = args.path as string;

          console.log(`🗑️ Deleting: ${path}`);

          if (!path) {
            return JSON.stringify({ error: 'Path is required' });
          }

          // Check if it's a file or folder
          if (!fs) {
            return JSON.stringify({ error: 'File system not available' });
          }
          const file = fs.getFile(path);
          const isFolder = fs.listFiles().some(f => f.path.startsWith(path + '/'));
          
          if (!file && !isFolder) {
            return JSON.stringify({ error: `File or folder not found: ${path}` });
          }

          try {
            const success = fs.deleteFile(path);
            if (success) {
              const itemType = file ? 'file' : 'folder';
              console.log(`✅ ${itemType} deleted successfully: ${path}`);
              return JSON.stringify({ 
                success: true, 
                message: `${itemType} deleted: ${path}`,
                path 
              });
            } else {
              return JSON.stringify({ error: `Failed to delete: ${path}` });
            }
          } catch (error) {
            console.error('❌ Failed to delete:', error);
            return JSON.stringify({ error: 'Failed to delete item' });
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

          if (!fs) {
            return JSON.stringify({ error: 'File system not available' });
          }

          const sourceFile = fs.getFile(fromPath);
          if (!sourceFile) {
            return JSON.stringify({ error: `Source file not found: ${fromPath}` });
          }

          const destFile = fs.getFile(toPath);
          if (destFile) {
            return JSON.stringify({ error: `Destination file already exists: ${toPath}` });
          }

          // Validate toPath format
          if (!toPath.startsWith('/')) {
            return JSON.stringify({ error: 'Destination path must start with /' });
          }

          try {
            // Rename the file (this handles both files and folders)
            const success = fs.renameFile(fromPath, toPath);
            
            if (!success) {
              return JSON.stringify({ 
                error: `Failed to move file from ${fromPath} to ${toPath}. Source may not exist or destination already exists.` 
              });
            }

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

          if (!fs) {
            return JSON.stringify({ error: 'File system not available' });
          }

          const file = fs.getFile(path);
          if (!file) {
            return JSON.stringify({ error: `File not found: ${path}` });
          }

          try {
            const fileInfo = {
              path,
              size: file.content.length,
              content: file.content,
              contentType: file.contentType,
              createdAt: file.createdAt.toISOString(),
              updatedAt: file.updatedAt.toISOString(),
            };

            console.log(`✅ File read successfully: ${path} (${file.content.length} chars)`);
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
            if (!activeFile) {
              return JSON.stringify({ 
                success: true,
                message: 'No file is currently active',
                currentPath: null
              });
            }

            console.log(`✅ Current file path: ${activeFile}`);
            return JSON.stringify({ 
              success: true, 
              currentPath: activeFile
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
            if (!activeFile) {
              return JSON.stringify({ 
                success: true,
                message: 'No file is currently active',
                currentFile: null
              });
            }

            if (!fs) {
              return JSON.stringify({ error: 'File system not available' });
            }

            const file = fs.getFile(activeFile);
            if (!file) {
              return JSON.stringify({ 
                error: `Active file not found: ${activeFile}` 
              });
            }

            const fileInfo = {
              path: file.path,
              size: file.content.length,
              content: file.content,
              contentType: file.contentType,
              createdAt: file.createdAt.toISOString(),
              updatedAt: file.updatedAt.toISOString(),
            };

            console.log(`✅ Current file: ${activeFile} (${file.content.length} chars)`);
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
  }, [fs, activeFile]);
  
  return {
    ...context,
    artifactsTools,
  };
}
