import mime from 'mime';

// Helper function to detect MIME type from data URL or file extension
export function detectMimeType(data: string, filename: string): string {
  // Check if data is a data URL
  if (data.startsWith('data:')) {
    const mimeMatch = data.match(/^data:([^;]+)/);
    if (mimeMatch) return mimeMatch[1];
  }
  
  // Use mime library to get MIME type from file extension
  const mimeType = mime.getType(filename);
  return mimeType || 'application/octet-stream';
}
