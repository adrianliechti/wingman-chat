import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Button } from '@headlessui/react';
import { ShieldCheck, X } from 'lucide-react';

interface MCPAuthPromptProps {
  isOpen: boolean;
  serverName: string;
  onAuthorize: () => void;
  onCancel: () => void;
}

export function MCPAuthPrompt({ isOpen, serverName, onAuthorize, onCancel }: MCPAuthPromptProps) {
  return (
    <Dialog open={isOpen} onClose={onCancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
      
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl bg-white dark:bg-neutral-900 p-6 shadow-2xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <ShieldCheck className="text-blue-600 dark:text-blue-400" size={24} />
              </div>
              <DialogTitle className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Authorization Required
              </DialogTitle>
            </div>
            <Button
              onClick={onCancel}
              className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <X size={20} />
            </Button>
          </div>
          
          <div className="mb-6">
            <p className="text-neutral-600 dark:text-neutral-400">
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{serverName}</span> requires authorization to access its tools and resources.
            </p>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-500">
              Click "Authorize" to open the authentication window.
            </p>
          </div>
          
          <div className="flex gap-3 justify-end">
            <Button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </Button>
            <Button
              onClick={onAuthorize}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm"
            >
              Authorize
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
