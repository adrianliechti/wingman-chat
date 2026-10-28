import type { ParsedSkill } from "@/features/skills/lib/skillParser";
import type { InstalledPlugin } from "@/features/plugins/lib/types";

export interface SkillTrigger {
  start: number;
  end: number;
  query: string;
}

export type SkillSuggestion = Pick<ParsedSkill, "name" | "description">;

/** Complete a slash token at the caret, excluding URLs, code, and selected text. */
export function skillTrigger(content: string, start: number, end = start): SkillTrigger | null {
  if (start !== end) return null;
  const before = content.slice(0, start);
  const match = /(?:^|\s)\/([^\s/`]*)$/.exec(before);
  if (!match) return null;
  if (
    (before.match(/```/g)?.length ?? 0) % 2 ||
    (before
      .split("\n")
      .at(-1)!
      .match(/(?<!`)`(?!`)/g)?.length ?? 0) % 2
  )
    return null;
  const suffix = /^[^\s/`]*/.exec(content.slice(start))![0];
  return { start: start - match[1].length - 1, end: start + suffix.length, query: match[1] };
}

/** Manual selection is independent of automatic skill and plugin toggles. */
export function availableSkills(
  personal: readonly ParsedSkill[],
  plugins: readonly InstalledPlugin[],
): SkillSuggestion[] {
  return [
    ...personal.map(({ name, description }) => ({ name, description })),
    ...plugins.flatMap((plugin) =>
      plugin.skills.map((skill) => ({
        name: `${encodeURIComponent(plugin.id)}:${skill.name}`,
        description: skill.description,
      })),
    ),
  ];
}

export function matchingSkills(skills: readonly SkillSuggestion[], query: string): SkillSuggestion[] {
  const needle = query.toLocaleLowerCase();
  const rank = (skill: SkillSuggestion) => {
    const name = skill.name.toLocaleLowerCase();
    return !needle || name.startsWith(needle)
      ? 0
      : name.includes(needle)
        ? 1
        : skill.description.toLocaleLowerCase().includes(needle)
          ? 2
          : 3;
  };
  return skills
    .filter((skill) => rank(skill) < 3)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, 40);
}
