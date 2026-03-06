import { lookupContentType } from './utils';

export function inferContentTypeFromPath(path: string): string | undefined {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) {
    return undefined;
  }

  return lookupContentType(path.slice(lastDot));
}

export function isTextContentType(contentType?: string): boolean {
  if (!contentType) {
    return true;
  }

  return contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript' ||
    contentType === 'application/xml' ||
    contentType === 'application/yaml' ||
    contentType === 'application/x-yaml' ||
    contentType === 'application/toml' ||
    contentType === 'application/x-sh' ||
    contentType === 'application/sql' ||
    contentType === 'image/svg+xml';
}

export function isBinaryContentType(contentType?: string): boolean {
  return !!contentType && !isTextContentType(contentType);
}