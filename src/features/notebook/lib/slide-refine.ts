/**
 * Refinement of a single slide in an already-generated deck.
 *
 * For HTML slides we round-trip the slide markup through the LLM with the
 * user's edit instruction. For image slides we regenerate the slide image
 * (using the previous image as a style reference so the deck stays coherent).
 *
 * Returns the updated `NotebookOutput`. Throws on failure — callers should
 * surface errors in the UI.
 */

import { getConfig } from "@/shared/config";
import { blobToDataUrl, dataUrlToBlob } from "@/shared/lib/opfs-core";
import { getTextFromContent } from "@/shared/types/chat";
import type { NotebookOutput } from "../types/notebook";

const HTML_REFINE_PROMPT =
  "You are refining a single HTML slide. The slide is a self-contained HTML document (1920x1080px, 16:9). " +
  "Apply the user's refinement request. Return ONLY the complete updated HTML document.";

const IMAGE_REFINE_PROMPT =
  "You are generating an image prompt for a presentation slide. " +
  "Based on the slide content and refinement request, create a detailed image generation prompt. " +
  'Return ONLY the prompt. End with "16:9 aspect ratio."';

function stripCodeFence(s: string): string {
  return s
    .replace(/^```html?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function refineSlide(
  output: NotebookOutput,
  slideIndex: number,
  refinement: string,
): Promise<NotebookOutput> {
  const slides = output.slides ?? [];
  const current = slides[slideIndex];
  if (!current) return output;

  const config = getConfig();
  const client = config.client;
  const model = config.notebook?.model || "";
  const isHtml = output.slideContentType === "text/html";

  if (isHtml) {
    const result = await client.complete(
      model,
      HTML_REFINE_PROMPT,
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Current slide HTML:\n\n${current}\n\nRefinement request: ${refinement}`,
            },
          ],
        },
      ],
      [],
    );

    const newHtml = getTextFromContent(result.content);
    if (!newHtml?.trim()) return output;

    const cleaned = stripCodeFence(newHtml);
    const updated = [...slides];
    updated[slideIndex] = cleaned;
    return { ...output, slides: updated };
  }

  // Image mode
  const rendererModel = config.notebook?.renderer || config.renderer?.model || "";
  const slideTexts = output.content.split(/\n\n---\n\n/);
  const slideText = slideTexts[slideIndex] || "";

  const result = await client.complete(
    model,
    IMAGE_REFINE_PROMPT,
    [
      {
        role: "user",
        content: [{ type: "text", text: `Slide content:\n${slideText}\n\nRefinement request: ${refinement}` }],
      },
    ],
    [],
  );

  const imagePrompt = getTextFromContent(result.content);
  if (!imagePrompt?.trim()) return output;

  // Pass the current slide image as a reference so palette, typography, and
  // layout stay consistent with the rest of the deck.
  const currentBlob = await dataUrlToBlob(current);
  const imageBlob = await client.generateImage(rendererModel, imagePrompt.trim(), [currentBlob]);
  const imageUrl = await blobToDataUrl(imageBlob);

  const updated = [...slides];
  updated[slideIndex] = imageUrl;
  return { ...output, slides: updated };
}
