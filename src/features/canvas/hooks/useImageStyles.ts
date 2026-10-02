import { useEffect, useMemo, useState } from "react";
import { loadSkillResource, loadSkillTemplate, loadSkillTemplates } from "@/features/skills/lib/templates";
import { type ImageStyle, parseImageStyles } from "@/shared/lib/imageStyles";

const STYLE_RESOURCE = "references/image-styles.md";

export async function loadImageStyles(): Promise<ImageStyle[] | null> {
  try {
    const templates = await loadSkillTemplates();
    const design = templates.find((t) => t.name === "canvas-design" && t.resources?.includes(STYLE_RESOURCE));
    if (design) {
      const content = await loadSkillResource(design.path, STYLE_RESOURCE);
      return content === null ? null : parseImageStyles(content);
    }
    // Older/custom deployments may still supply the standalone style catalog.
    const legacy = templates.find((t) => t.name === "image-styles");
    if (!legacy) return null;
    const skill = await loadSkillTemplate(legacy.path);
    return skill ? parseImageStyles(skill.content) : null;
  } catch (error) {
    console.error("Failed to load image styles:", error);
    return null;
  }
}

/**
 * Loads the optional style reference shared with canvas-design. Deployments can
 * customize it without rebuilding. The skill body stays focused on the task;
 * neither the model nor the picker needs to load unrelated design instructions.
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
