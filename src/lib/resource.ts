import mime from 'mime';
import { AttachmentType, type Attachment } from "../types/chat";

export interface Resource {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    blob?: string;  // base64 encoded content
    text?: string;  // plain text content
  };
}

export interface ParsedToolResult {
  attachments?: Attachment[];
  processedContent: string;
}

export function parseResource(result: string): ParsedToolResult {
  let attachments: Attachment[] | undefined = undefined;
  let processedContent = result;

  try {
    const parsedResult = JSON.parse(result || "{}");
    
    // Check for special resource results
    if (isResourceResult(parsedResult)) {
      const resource = parsedResult.resource;
      
      let attachmentType = AttachmentType.File;

      if (resource.uri.startsWith('ui://')) {
        attachmentType = AttachmentType.UI;
      }
      
      if (resource.mimeType.startsWith('image/')) {
        attachmentType = AttachmentType.Image;
      }
      
      if (resource.mimeType.startsWith('text/')) {
        attachmentType = AttachmentType.Text;
      }

      // Extract filename from URI or use a default name
      const fileName = extractFileNameFromUri(resource.uri, resource.mimeType);

      // Use blob (base64) or text content, preferring blob if both are present
      const contentData = resource.blob || resource.text || '';

      attachments = [{
        type: attachmentType,
        name: fileName,
        data: contentData
      }];

      processedContent = `Resource ${fileName} (${resource.mimeType}) received and displayed above.`;
    }
  } catch {
    // If parsing fails, use the result as-is
  }

  return {
    attachments,
    processedContent: processedContent ?? "No result returned"
  };
}

/**
 * Type guard to check if a parsed result is a ResourceResult
 */
function isResourceResult(obj: unknown): obj is Resource {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  
  const candidate = obj as Record<string, unknown>;
  
  if (candidate.type !== 'resource' || !candidate.resource || typeof candidate.resource !== 'object') {
    return false;
  }
  
  const resource = candidate.resource as Record<string, unknown>;
  
  return (
    typeof resource.uri === 'string' &&
    typeof resource.mimeType === 'string' &&
    (typeof resource.blob === 'string' || typeof resource.text === 'string')
  );
}

/**
 * Extracts a filename from a URI or creates a default one based on MIME type
 */
function extractFileNameFromUri(uri: string, mimeType: string): string {
  const uriParts = uri.split('/');
  const lastPart = uriParts[uriParts.length - 1];
  
  if (lastPart && lastPart.includes('.')) {
    return lastPart;
  }
  
  const extension = mime.getExtension(mimeType);
  return `resource.${extension}`;
}