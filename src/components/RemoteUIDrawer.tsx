import { useRemoteUIContext } from '../hooks/useRemoteUIContext';
import { 
  UIResourceRenderer, 
  UIActionResult,
  basicComponentLibrary,
  remoteTextDefinition,
  remoteButtonDefinition
} from '@mcp-ui/client';

export function RemoteUIDrawer() {
  const { resource } = useRemoteUIContext();

  const handleGenericMcpAction = async (result: UIActionResult) => {
    console.log('MCP Action:', result);
    return result;
  };

  if (!resource) {
    return null;
  }

  const data = resource.blob 
    ? {
        uri: resource.uri,
        mimeType: resource.mimeType,
        name: resource.uri,
        blob: resource.blob
      }
    : {
        uri: resource.uri,
        mimeType: resource.mimeType,
        name: resource.uri,
        text: resource.text
      };

  return (
    <div className="w-full h-full">
      <UIResourceRenderer
        resource={data}
        onUIAction={handleGenericMcpAction}
        htmlProps={{
          style: { width: '100%', height: '100%' },
          iframeProps: {
            className: 'w-full h-full border-none'
          }
        }}
        remoteDomProps={{
          library: basicComponentLibrary,
          remoteElements: [remoteButtonDefinition, remoteTextDefinition],
        }}
      />
    </div>
  );
}
