import { Settings } from 'lucide-react';

interface SettingsButtonProps {
  onClick?: () => void;
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out"
      aria-label="Open settings"
    >
      <Settings size={20} />
    </button>
  );
}
