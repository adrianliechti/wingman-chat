/**
 * Tools for image-based slide generation.
 * The LLM plans the deck and calls `generate_slide` for each slide,
 * which generates a full-page 16:9 image via the renderer model.
 */

import type { Client } from "@/shared/lib/client";
import { blobToDataUrl } from "@/shared/lib/opfs-core";
import type { TextContent, Tool } from "@/shared/types/chat";

function textResult(text: string): TextContent[] {
  return [{ type: "text" as const, text }];
}

/**
 * Create tools for generating image-based slides.
 * `onSlide` is called after each slide is generated so the UI can show progress.
 */
export function createImageSlideTools(
  slides: Map<number, string>,
  client: Client,
  rendererModel: string,
  onSlide: () => void,
): Tool[] {
  // The first successfully-generated slide is kept as a style reference for
  // every subsequent slide (edit mode), so the whole deck shares a look.
  let styleReference: Blob | null = null;

  return [
    {
      name: "generate_slide",
      description:
        "Generate a full-page 16:9 slide image from a detailed visual prompt. " +
        "Call this once per slide, in order. The first slide establishes the deck's " +
        "visual style; subsequent slides are generated with the first as a reference " +
        "so typography, palette, and overall design stay consistent.",
      parameters: {
        type: "object",
        properties: {
          slide_number: {
            type: "number",
            description: "Slide number (1-indexed, sequential).",
          },
          prompt: {
            type: "string",
            description:
              "Detailed image generation prompt for this slide. " +
              "Describe the visual layout, text content, colors, imagery, and style. " +
              "The image will be rendered at 16:9 aspect ratio (1920×1080).",
          },
        },
        required: ["slide_number", "prompt"],
      },
      function: async (args) => {
        const slideNumber = args.slide_number as number;
        const prompt = args.prompt as string;

        try {
          const fullPrompt = `A professional presentation slide (16:9 landscape format, clean design). ${prompt}`;
          const refs = styleReference ? [styleReference] : undefined;
          const blob = await client.generateImage(rendererModel, fullPrompt, refs);
          if (!styleReference) {
            styleReference = blob;
          }
          const dataUrl = await blobToDataUrl(blob);
          slides.set(slideNumber, dataUrl);
          console.log(`[Image Slides] Generated slide ${slideNumber}`);
          onSlide();
          return textResult(`OK: generated slide ${slideNumber}.`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Image generation failed";
          console.warn(`[Image Slides] Failed to generate slide ${slideNumber}:`, msg);
          return textResult(`Error generating slide ${slideNumber}: ${msg}`);
        }
      },
    },
  ];
}
