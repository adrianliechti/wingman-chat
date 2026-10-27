import { ChevronDown, Loader2, Play } from "lucide-react";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import type { SkillTemplate } from "../lib/templates";

export function WorkflowMenu({
  starters,
  loading,
  disabled,
  onSelect,
}: {
  starters: SkillTemplate[];
  loading: boolean;
  disabled: boolean;
  onSelect: (starter: SkillTemplate) => void;
}) {
  return (
    <DropdownMenu
      anchor="top"
      panelClassName="w-64 max-w-[calc(100vw-2rem)] max-h-[55vh] overflow-y-auto"
      trigger={
        <MenuButton
          disabled={disabled || loading}
          title={disabled ? "Choose a chat model with skills and document tools" : undefined}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200/80 bg-white/80 px-3 py-1.5 text-xs text-neutral-600 backdrop-blur hover:bg-white disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Start a workflow
          <ChevronDown size={13} />
        </MenuButton>
      }
    >
      {starters.map((starter) => (
        <DropdownMenuItem key={starter.path} icon={<Play size={14} />} onClick={() => onSelect(starter)}>
          {starter.name.charAt(0).toUpperCase() + starter.name.slice(1).replaceAll("-", " ")}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
