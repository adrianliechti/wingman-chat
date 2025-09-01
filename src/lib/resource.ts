import mime from 'mime';
import { AttachmentType, type Attachment } from "../types/chat";

export interface Resource {
  type: "resource";
  resource: {
    uri: string;
    name?: string;
    mimeType: string;
    blob?: string;  // base64 encoded content
    text?: string;  // plain text content
    _meta?: Record<string, unknown>;
  };
}

export function parseResource(text: string): Attachment[] | undefined {
  let result: Attachment[] | undefined = undefined;

  try {
    const content = JSON.parse(text || "{}");
    
    if (isResource(content)) {
      const resource = content.resource;
      
      let type = AttachmentType.File;

      let name = '';
      let data = '';
      
      if (resource.name) {
        name = resource.name;
      } else {
        // Extract filename from URI or use a default name
        name = nameFromUri(resource.uri, resource.mimeType);
      }

      if (resource.uri?.startsWith('ui://')) {
        name = resource.uri;
      }

      if (resource.text) {
        type = AttachmentType.File;
        data = `data:${resource.mimeType};base64,${btoa(resource.text)}`;
      }
      
      if (resource.blob) {
        type = AttachmentType.File;
        data = `data:${resource.mimeType};base64,${resource.blob}`;
        
        if (resource.mimeType.startsWith('image/')) {
          type = AttachmentType.Image;
        }
      }

      result = [{
        type: type,
        name: name,
        data: data,
        meta: resource._meta
      }];
    }
  } catch {
    // If parsing fails, use the result as-is
  }

  return result;
}

function isResource(obj: unknown): obj is Resource {
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

function nameFromUri(uri: string, mimeType: string): string {
  const lastPart = uri.split('/').pop();
  
  if (lastPart?.includes('.')) {
    return lastPart;
  }

  const extension = mimeType ? mime.getExtension(mimeType) : null;
  return extension ? `resource.${extension}` : '';
}