import { ExternalLink, GraduationCap, Receipt, Settings } from "lucide-react";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { getConfig } from "@/shared/config";
import { Avatar } from "@/shared/ui/Avatar";
import {
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuItem,
  MenuButton,
} from "@/shared/ui/DropdownMenu";

interface AccountMenuProps {
  onOpenSettings: (opts: { advanced: boolean; section?: string }) => void;
}

export function AccountMenu({ onOpenSettings }: AccountMenuProps) {
  const config = getConfig();
  const { profile } = useSettings();

  return (
    <DropdownMenu
      anchor="bottom end"
      panelClassName="min-w-72"
      trigger={
        <MenuButton
          className="flex h-8 w-8 items-center justify-center rounded transition-colors text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
          aria-label="Account menu"
        >
          <Avatar name={profile.name} className="bg-black text-white dark:bg-black dark:text-white" />
        </MenuButton>
      }
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <Avatar name={profile.name} className="bg-black text-white dark:bg-black dark:text-white" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {profile.name || "You"}
          </div>
          {profile.role && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{profile.role}</div>
          )}
        </div>
      </div>

      {config.support?.url && (
        <>
          <DropdownMenuDivider />
          <DropdownMenuItem
            icon={<GraduationCap size={18} className="mr-1" />}
            render={({ className, children }) => (
              <a href={config.support?.url} target="_blank" rel="noopener noreferrer" className={className}>
                {children}
              </a>
            )}
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate">{config.support.title?.trim() || "Support"}</span>
                {config.support.description && (
                  <span className="mt-0.5 block text-xs leading-snug font-normal text-neutral-500 dark:text-neutral-400">
                    {config.support.description}
                  </span>
                )}
              </span>
              <ExternalLink size={13} className="shrink-0 opacity-60" />
            </span>
          </DropdownMenuItem>
        </>
      )}

      {config.costDashboard?.url && (
        <DropdownMenuItem
          icon={<Receipt size={18} className="mr-1" />}
          render={({ className, children }) => (
            <a href={config.costDashboard?.url} target="_blank" rel="noopener noreferrer" className={className}>
              {children}
            </a>
          )}
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate">{config.costDashboard.title?.trim() || "Cost Dashboard"}</span>
              {config.costDashboard.description && (
                <span className="mt-0.5 block text-xs leading-snug font-normal text-neutral-500 dark:text-neutral-400">
                  {config.costDashboard.description}
                </span>
              )}
            </span>
            <ExternalLink size={13} className="shrink-0 opacity-60" />
          </span>
        </DropdownMenuItem>
      )}

      <DropdownMenuDivider />
      <DropdownMenuItem
        icon={<Settings size={18} className="mr-1" />}
        onClickEvent={(e) => onOpenSettings({ advanced: e.altKey })}
      >
        Settings
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
