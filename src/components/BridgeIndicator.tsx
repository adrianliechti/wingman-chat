import { Cable } from 'lucide-react';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';
import { useBridge } from '../hooks/useBridge';

export function BridgeIndicator() {
  const { bridgeTools } = useBridge();

  // Don't render if no bridge tools are available
  if (bridgeTools.length === 0) {
    return null;
  }

  return (
    <Menu as="div" className="relative">
      <MenuButton className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out">
        <Cable size={20} />
      </MenuButton>
      
      <MenuItems
        transition
        anchor="bottom start"
        className="w-64 mt-2 rounded-lg border bg-white/90 dark:bg-black/90 backdrop-blur-xl border-white/30 dark:border-white/20 overflow-hidden shadow-lg z-50 transition duration-100 ease-out [--anchor-gap:var(--spacing-1)] data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-700">
          <div className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            Bridge Tools ({bridgeTools.length})
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Available tools from connected bridge
          </div>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {bridgeTools.map((tool, index) => (
            <MenuItem key={index}>
              <div className="px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                <div className="font-medium text-neutral-900 dark:text-neutral-100 text-sm">
                  {tool.name}
                </div>
                {tool.description && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    {tool.description}
                  </div>
                )}
              </div>
            </MenuItem>
          ))}
        </div>
      </MenuItems>
    </Menu>
  );
}
