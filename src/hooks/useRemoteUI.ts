import { Tool } from "../types/chat";
import { useRemoteUIContext } from "./useRemoteUIContext";

export interface UIResource {
  uri: string;
  mimeType: 'text/html' | 'text/uri-list' | 'application/vnd.mcp-ui.remote-dom';
  text?: string;
  blob?: string;
}

export function useRemoteUI() {
  const { setResource, resource, setShowRemoteUIDrawer } = useRemoteUIContext();

  const tools: Tool[] = [
    {
      name: 'render_ui_resource',
      description: 'Render ui resources received from tools calls',
      parameters: {
        type: 'object',
        properties: {
          uri: {
            type: 'string',
            description: 'The URI identifier for the UI resource (e.g., ui://component/id)'
          },
          mimeType: {
            type: 'string',
            enum: ['text/html', 'text/uri-list', 'application/vnd.mcp-ui.remote-dom'],
            description: 'The MIME type of the resource: text/html for HTML content, text/uri-list for URL content, application/vnd.mcp-ui.remote-dom for remote-dom content (Javascript)'
          },
          text: {
            type: 'string',
            description: 'Inline HTML content or external URL (optional)'
          },
          blob: {
            type: 'string',
            description: 'Base64-encoded HTML content or URL (optional)'
          }
        },
        required: ['uri', 'mimeType']
      },
      function: async (args: Record<string, unknown>): Promise<string> => {
        const { uri, mimeType, text, blob } = args as {
          uri: string;
          mimeType: 'text/html' | 'text/uri-list' | 'application/vnd.mcp-ui.remote-dom';
          text?: string;
          blob?: string;
        };

        console.log(`🎨 render_ui_resource tool invoked for URI: "${uri}"`);

        if (!uri) {
          console.log('❌ No URI provided');
          return JSON.stringify({ error: 'URI is required' });
        }

        if (!mimeType) {
          console.log('❌ No mimeType provided');
          return JSON.stringify({ error: 'mimeType is required' });
        }

        if (!text && !blob) {
          console.log('❌ Neither text nor blob content provided');
          return JSON.stringify({ error: 'Either text or blob content is required' });
        }

        try {
          const newResource: UIResource = {
            uri,
            mimeType,
            text,
            blob
          };

          setResource(newResource);
          
          // Automatically show the drawer when a new resource is added
          setShowRemoteUIDrawer(true);

          console.log(`✅ UI resource rendered successfully for URI: ${uri}`);
          return JSON.stringify({
            success: true,
            uri,
            mimeType,
            message: 'UI resource rendered successfully'
          });
        } catch (error) {
          console.error('❌ Error rendering UI resource:', error);
          return JSON.stringify({
            error: 'Failed to render UI resource',
            details: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
  ];

  return {
    resource,
    setResource,
    tools
  };
}
