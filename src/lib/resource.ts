import mime from 'mime';
import { AttachmentType, type Attachment } from "../types/chat";

export interface Resource {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    blob?: string;  // base64 encoded content
    text?: string;  // plain text content
    _meta?: Record<string, unknown>;
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
      
      let attachmentType: AttachmentType;
      let data: string;
      
      // Extract filename from URI or use a default name
      const name = extractFileNameFromUri(resource.uri, resource.mimeType);

      if (resource.text) {
        attachmentType = AttachmentType.Text;
        data = resource.text;
      } else if (resource.blob) {
        attachmentType = AttachmentType.File;
        
        if (resource.mimeType.startsWith('image/')) {
          attachmentType = AttachmentType.Image;
        }
        
        data = `data:${resource.mimeType};base64,${resource.blob}`;
      } else {
        attachmentType = AttachmentType.File;
        data = '';
      }

      attachments = [{
        type: attachmentType,
        name: name,
        data: data,
        meta: resource._meta
      }];

      processedContent = JSON.stringify({ successful: true });
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
  // MCP UI Resource
  if (uri.startsWith('ui://')) {
    return uri;
  }
  
  const uriParts = uri.split('/');
  const lastPart = uriParts[uriParts.length - 1];
  
  if (lastPart && lastPart.includes('.')) {
    return lastPart;
  }

  if (mimeType) {
    const extension = mime.getExtension(mimeType);
    return `resource.${extension}`;
  }

  return '';
}