import { useState, useCallback } from "react";
import type { ReactNode } from "react";
import { RendererContext } from "./RendererContext";
import type { RendererContextType } from "./RendererContext";
import type { Tool, ToolContext, ToolProvider } from "../types/chat";
import { AttachmentType } from "../types/chat";
import { getConfig } from "../config";
import { readAsDataURL } from "../lib/utils";
import type { Resource } from "../lib/resource";
import imageGenerationInstructionsText from '../prompts/image-generation.txt?raw';

interface RendererProviderProps {
  children: ReactNode;
}

export function RendererProvider({ children }: RendererProviderProps) {
  const [isEnabled, setEnabled] = useState(false);
  const config = getConfig();
  const [isAvailable] = useState(() => {
    try {
      return config.renderer.enabled;
    } catch (error) {
      console.warn('Failed to get image generation config:', error);
      return false;
    }
  });
  const client = config.client;

  const imageGenerationTools = useCallback((): Tool[] => {
    if (!isEnabled) {
      return [];
    }

    return [
      {
        name: "generate_image",
        description: "Generate or edit an image based on a text description. Can create new images from text prompts or edit existing images attached to the chat.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A detailed description of the image to generate or edit. For new images, describe the desired content, style, composition, and colors. For editing existing images, describe the changes or modifications you want to make."
            }
          },
          required: ["prompt"]
        },
        function: async (args: Record<string, unknown>, context?: ToolContext) => {
          const { prompt } = args;

          console.log("[generate_image] Starting image generation", { prompt });

          const images: Blob[] = [];

          // Extract image attachments from context
          if (context?.attachments) {
            const attachments = context.attachments();
            const imageAttachments = attachments.filter(att => att.type === AttachmentType.Image);
            
            for (const imageAttachment of imageAttachments) {
              try {
                const response = await fetch(imageAttachment.data);
                const blob = await response.blob();
                images.push(blob);
              } catch (error) {
                console.warn("[generate_image] Failed to convert attachment to blob:", error);
              }
            }
          }

          try {
            const imageBlob = await client.generateImage(
              config.renderer?.model || "",
              prompt as string,
              images
            );

            // Convert the image to a data URL for storage in attachments
            const fullDataUrl = await readAsDataURL(imageBlob);
            const imageDataUrl = fullDataUrl.split(',')[1];

            const imageName = `${Date.now()}.png`;

            console.log("[generate_image] Image generation completed successfully")

            // Return ResourceResult format
            const resourceResult: Resource = {
              type: "resource",
              resource: {
                uri: `file:///image/` + imageName,
                name: imageName,
                mimeType: imageBlob.type,
                blob: imageDataUrl
              }
            };

            return JSON.stringify(resourceResult);
          } catch (error) {
            console.error("[generate_image] Image generation failed", { prompt, error: error instanceof Error ? error.message : error });
            return JSON.stringify({
              success: false,
              error: `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
          }
        }
      }
    ];
  }, [isEnabled, client, config]);

  const rendererProvider = useCallback((): ToolProvider | null => {
    if (!isEnabled) {
      return null;
    }

    return {
      id: "image_generation",
      name: "Image Generation",
      description: "Generate or edit images based on text descriptions",
      tools: imageGenerationTools(),
      instructions: imageGenerationInstructionsText,
    };
  }, [isEnabled, imageGenerationTools]);

  const contextValue: RendererContextType = {
    isEnabled,
    setEnabled,
    isAvailable,
    rendererProvider,
  };

  return (
    <RendererContext.Provider value={contextValue}>
      {children}
    </RendererContext.Provider>
  );
}
