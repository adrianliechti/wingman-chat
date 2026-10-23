import {
  Activity,
  BookOpen,
  ChartNoAxesCombined,
  ExternalLink,
  GraduationCap,
  LifeBuoy,
  Link,
  type LucideIcon,
  Mail,
  MessageSquare,
  Receipt,
  Settings,
  Users,
} from "lucide-react";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { getConfig } from "@/shared/config";
import { useMe } from "@/shared/hooks/useMe";
import { Avatar } from "@/shared/ui/Avatar";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";

interface AccountMenuProps {
  onOpenSettings: (opts: { advanced: boolean; section?: string }) => void;
}

const LINK_ICONS = new Map<string, LucideIcon>([
  ["support", LifeBuoy],
  ["docs", BookOpen],
  ["learning", GraduationCap],
  ["cost", Receipt],
  ["dashboard", ChartNoAxesCombined],
  ["status", Activity],
  ["community", Users],
  ["feedback", MessageSquare],
  ["mail", Mail],
  ["link", Link],
]);

function AccountLinkIcon({ name }: { name?: string }) {
  const Icon = LINK_ICONS.get(name?.trim().toLowerCase() ?? "") ?? Link;
  return <Icon size={18} className="mr-1" />;
}

export function AccountMenu({ onOpenSettings }: AccountMenuProps) {
  const config = getConfig();
  const { profile } = useSettings();
  const me = useMe();

  const displayName = me.name || profile.name;

  return (
    <DropdownMenu
      anchor="bottom end"
      backdrop
      panelClassName="min-w-72"
      trigger={
        <MenuButton
          className="flex h-8 w-8 items-center justify-center rounded transition-colors text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
          aria-label="Account menu"
        >
          <Avatar name={displayName} className="bg-black text-white dark:bg-white dark:text-black" />
        </MenuButton>
      }
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <Avatar name={displayName} className="bg-black text-white dark:bg-white dark:text-black" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {displayName || "You"}
          </div>
          {me.email ? (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{me.email.toLowerCase()}</div>
          ) : (
            profile.role && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{profile.role}</div>
            )
          )}
        </div>
      </div>

      {config.links.length > 0 && (
        <>
          <DropdownMenuDivider />
          {config.links.map((link, index) => (
            <DropdownMenuItem
              key={`${link.url}-${index}`}
              icon={<AccountLinkIcon name={link.icon} />}
              render={({ className, children }) => (
                <a href={link.url} target="_blank" rel="noopener noreferrer" className={className}>
                  {children}
                </a>
              )}
            >
              <span className="flex w-full items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate">{link.title}</span>
                  {link.description && (
                    <span className="mt-0.5 block text-xs leading-snug font-normal text-neutral-500 dark:text-neutral-400">
                      {link.description}
                    </span>
                  )}
                </span>
                <ExternalLink size={13} className="shrink-0 opacity-60" />
              </span>
            </DropdownMenuItem>
          ))}
        </>
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
