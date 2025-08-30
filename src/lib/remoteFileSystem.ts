import type { RemoteFileItem, RemoteFileSystemResponse, RemoteFileSource } from '../types/repository';
import { getConfig } from '../config';

// Mock data for different file sources
const mockFileStructure: Record<string, Record<string, RemoteFileItem[]>> = {
  'onedrive': {
    '/': [
      { id: '1', name: 'Documents', type: 'folder', path: '/Documents' },
      { id: '2', name: 'Pictures', type: 'folder', path: '/Pictures' },
      { id: '3', name: 'readme.txt', type: 'file', path: '/readme.txt', size: 1024, mimeType: 'text/plain' },
    ],
    '/Documents': [
      { id: '4', name: 'Projects', type: 'folder', path: '/Documents/Projects' },
      { id: '5', name: 'report.pdf', type: 'file', path: '/Documents/report.pdf', size: 2048, mimeType: 'application/pdf' },
      { id: '6', name: 'notes.txt', type: 'file', path: '/Documents/notes.txt', size: 512, mimeType: 'text/plain' },
    ],
    '/Documents/Projects': [
      { id: '7', name: 'project1.md', type: 'file', path: '/Documents/Projects/project1.md', size: 1536, mimeType: 'text/markdown' },
      { id: '8', name: 'project2.md', type: 'file', path: '/Documents/Projects/project2.md', size: 2048, mimeType: 'text/markdown' },
    ],
    '/Pictures': [
      { id: '9', name: 'vacation.jpg', type: 'file', path: '/Pictures/vacation.jpg', size: 102400, mimeType: 'image/jpeg' },
      { id: '10', name: 'screenshot.png', type: 'file', path: '/Pictures/screenshot.png', size: 51200, mimeType: 'image/png' },
    ],
  },
  'googledrive': {
    '/': [
      { id: '11', name: 'My Drive', type: 'folder', path: '/My Drive' },
      { id: '12', name: 'Shared with me', type: 'folder', path: '/Shared with me' },
    ],
    '/My Drive': [
      { id: '13', name: 'Work', type: 'folder', path: '/My Drive/Work' },
      { id: '14', name: 'Personal', type: 'folder', path: '/My Drive/Personal' },
      { id: '15', name: 'presentation.pptx', type: 'file', path: '/My Drive/presentation.pptx', size: 4096, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    ],
    '/My Drive/Work': [
      { id: '16', name: 'specs.docx', type: 'file', path: '/My Drive/Work/specs.docx', size: 3072, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { id: '17', name: 'budget.xlsx', type: 'file', path: '/My Drive/Work/budget.xlsx', size: 2560, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ],
  },
  'github': {
    '/': [
      { id: '18', name: 'username', type: 'folder', path: '/username' },
    ],
    '/username': [
      { id: '19', name: 'repo1', type: 'folder', path: '/username/repo1' },
      { id: '20', name: 'repo2', type: 'folder', path: '/username/repo2' },
    ],
    '/username/repo1': [
      { id: '21', name: 'src', type: 'folder', path: '/username/repo1/src' },
      { id: '22', name: 'README.md', type: 'file', path: '/username/repo1/README.md', size: 1024, mimeType: 'text/markdown' },
      { id: '23', name: 'package.json', type: 'file', path: '/username/repo1/package.json', size: 512, mimeType: 'application/json' },
    ],
  },
};

// Mock sources configuration
export const mockRemoteSources: RemoteFileSource[] = [
  {
    id: 'onedrive',
    name: 'OneDrive',
    type: 'onedrive',
    enabled: true
  },
  {
    id: 'googledrive',
    name: 'Google Drive',
    type: 'googledrive',
    enabled: true
  },
  {
    id: 'github',
    name: 'GitHub',
    type: 'github',
    enabled: true
  }
];

export class RemoteFileSystemAPI {
  /**
   * Get available remote file sources
   */
  static async getSources(): Promise<RemoteFileSource[]> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      const config = getConfig();
      const configuredSources = config.sources || [];
      return configuredSources.filter(source => source.enabled);
    } catch {
      console.warn('Unable to load config, falling back to mock sources');
      return mockRemoteSources.filter(source => source.enabled);
    }
  }

  /**
   * Browse files and folders in a remote source
   */
  static async browse(sourceId: string, path: string = '/'): Promise<RemoteFileSystemResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 200));

    const sourceData = mockFileStructure[sourceId];
    if (!sourceData) {
      throw new Error(`Source ${sourceId} not found`);
    }

    const items = sourceData[path] || [];
    
    return {
      items: items.map(item => ({
        ...item,
        modifiedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) // Random date within last 30 days
      })),
      hasMore: false,
      nextToken: undefined
    };
  }

  /**
   * Download a file from a remote source
   */
  static async downloadFile(sourceId: string, filePath: string): Promise<File> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Find the file in mock data
    const sourceData = mockFileStructure[sourceId];
    if (!sourceData) {
      throw new Error(`Source ${sourceId} not found`);
    }

    // Find the file by searching through all paths
    let fileItem: RemoteFileItem | undefined;
    for (const items of Object.values(sourceData)) {
      fileItem = items.find(item => item.path === filePath && item.type === 'file');
      if (fileItem) break;
    }

    if (!fileItem) {
      throw new Error(`File ${filePath} not found in ${sourceId}`);
    }

    // Create a mock file with some content
    const content = `Mock content for ${fileItem.name} from ${sourceId}\n\nThis is simulated file content that would normally be downloaded from the remote source.`;
    const blob = new Blob([content], { type: fileItem.mimeType || 'text/plain' });
    
    return new File([blob], fileItem.name, {
      type: fileItem.mimeType || 'text/plain',
      lastModified: fileItem.modifiedAt?.getTime() || Date.now()
    });
  }
}
