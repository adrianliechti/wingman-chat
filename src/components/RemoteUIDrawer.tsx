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

  return (
    <UIResourceRenderer
      resource={resource as any}
      onUIAction={handleGenericMcpAction}
      remoteDomProps={{
        library: basicComponentLibrary,
        remoteElements: [remoteButtonDefinition, remoteTextDefinition],
      }}
    />
  );
}
