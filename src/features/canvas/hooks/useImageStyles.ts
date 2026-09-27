import { useEffect, useMemo, useState } from "react";
import { loadSkillTemplate, loadSkillTemplates } from "@/features/skills";
import { type ImageStyle, parseImageStyles } from "@/shared/lib/imageStyles";

const STYLE_SKILL_NAME = "image-styles";

async function loadImageStyles(): Promise<ImageStyle[] | null> {
  try {
    const template = (await loadSkillTemplates()).find((t) => t.name === STYLE_SKILL_NAME);
    if (!template) return null;
    const skill = await loadSkillTemplate(template.path);
    return skill ? parseImageStyles(skill.content) : null;
  } catch (error) {
    console.error("Failed to load image styles:", error);
    return null;
  }
}

/**
 * Loads named image styles at runtime from the served `image-styles` skill, so
 * adding, removing, or editing that skill (e.g. mounted into the Docker image)
 * changes the Canvas style picker without a rebuild — the same source the chat
 * path reads via `read_skill`. Empty when the skill isn't served.
 */
export function useImageStyles(): { styles: ImageStyle[]; prompts: Record<string, string> } {
  const [styles, setStyles] = useState<ImageStyle[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadImageStyles().then((loaded) => {
      if (loaded && !cancelled) setStyles(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => ({ styles, prompts: Object.fromEntries(styles.map((s) => [s.name, s.prompt])) }), [styles]);
}
