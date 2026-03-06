import { ChevronRight } from 'lucide-react';

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onOpenToggle?: () => void;
  collapsible?: boolean;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({ title, icon, isOpen, onOpenToggle, collapsible = true, headerAction, children }: SectionProps) {
  return (
    <div className="border-b border-neutral-200/40 dark:border-neutral-700/40">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={collapsible ? onOpenToggle : undefined}
          className={`flex-1 flex items-center justify-between py-1 text-left ${!collapsible ? 'cursor-default' : ''}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-neutral-600 dark:text-neutral-400">{icon}</span>
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</span>
          </div>
          {collapsible && (
            <ChevronRight
              size={14}
              className={`text-neutral-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
            />
          )}
        </button>
        {headerAction && (
          <div className="shrink-0" onClick={e => e.stopPropagation()}>
            {headerAction}
          </div>
        )}
      </div>
      <div className={`grid transition-all duration-200 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
