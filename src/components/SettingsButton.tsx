import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@headlessui/react';
import { SettingsModal } from './SettingsModal';

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
        aria-label="Open settings"
      >
        <Settings size={20} />
      </Button>
      
      <SettingsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
