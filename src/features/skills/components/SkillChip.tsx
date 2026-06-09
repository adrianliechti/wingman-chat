import { Expand, Sparkles } from "lucide-react";
import { memo } from "react";
import { cn } from "@/shared/lib/cn";
import { useSkills } from "../hooks/useSkills";

/**
 * Inline, clickable reference to a skill shown in the conversation after the
 * assistant creates or updates one. Clicking opens the Skill Explorer modal
 * focused on that skill. When the skill no longer exists the chip greys out
 * and is non-clickable.
 */
export const SkillChip = memo(function SkillChip({ name, className }: { name: string; className?: string }) {
  const { getSkill, openSkillCatalog } = useSkills();

  const skill = getSkill(name);
  const exists = !!skill;

  const handleOpen = () => {
    openSkillCatalog(name, true);
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={!exists}
      title={exists ? `Open skill: ${name}` : `${name} (no longer available)`}
      aria-label={exists ? `Open skill: ${name}` : `${name} (no longer available)`}
      className={cn(
        "group/skill inline-flex items-center gap-3 rounded-lg border px-3 py-2 text-left align-top transition-colors",
        "w-72 max-w-full",
        exists
          ? "border-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60"
          : "cursor-not-allowed border-neutral-200/60 bg-neutral-50/50 opacity-50 dark:border-neutral-700/50 dark:bg-neutral-800/30",
        className,
      )}
    >
      <span className="shrink-0 flex items-center justify-center h-9 w-9 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800">
        <Sparkles className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium text-neutral-700 dark:text-neutral-200",
            !exists && "line-through",
          )}
        >
          {name}
        </span>
        <span className="block text-xs text-neutral-400 dark:text-neutral-500">
          {exists ? "Open in skills" : "No longer available"}
        </span>
      </span>

      {exists && (
        <Expand className="h-4 w-4 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover/skill:opacity-100" />
      )}
    </button>
  );
});
