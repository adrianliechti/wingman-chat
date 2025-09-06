import { useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { ImageGenerationContext } from "./ImageGenerationContext";
import type { ImageGenerationContextType } from "./ImageGenerationContext";
import type { Tool } from "../types/chat";
import { getConfig } from "../config";
import { readAsDataURL } from "../lib/utils";
import type { Resource } from "../lib/resource";

interface ImageGenerationProviderProps {
  children: ReactNode;
}

export function ImageGenerationProvider({ children }: ImageGenerationProviderProps) {
  const [isEnabled, setEnabled] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const config = getConfig();
  const client = config.client;

  // Check image generation availability from config
  useEffect(() => {
    try {
      const config = getConfig();
      setIsAvailable(config.image.enabled);
    } catch (error) {
      console.warn('Failed to get image generation config:', error);
      setIsAvailable(false);
    }
  }, []);

  const imageGenerationTools = useCallback((): Tool[] => {
    if (!isEnabled) {
      return [];
    }

    return [
      {
        name: "generate_image",
        description: "Generate an image based on a text description",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A detailed description of the image to generate. Be specific about style, composition, colors, and other visual elements."
            }
          },
          required: ["prompt"]
        },
        function: async (args: Record<string, unknown>) => {
          const { prompt } = args;

          console.log("[generate_image] Starting image generation", { prompt });

          try {
            const imageBlob = await client.generateImage(
              config.image?.model || "",
              prompt as string
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

  const imageGenerationInstructions = useCallback((): string => {
    if (!isEnabled) {
      return "";
    }

    return `
      You have access to image generation functionality using DALL-E.
      
      - Use the generate_image tool when the user asks you to create, generate, or make an image.
      - Create detailed and specific prompts for better image quality.
      - Consider the user's preferences for style, composition, colors, and other visual elements.
      
      Always use this tool when the user requests image creation or visual content generation.
    `.trim();
  }, [isEnabled]);

  const contextValue: ImageGenerationContextType = {
    isEnabled,
    setEnabled,
    isAvailable,
    imageGenerationTools,
    imageGenerationInstructions,
  };

  return (
    <ImageGenerationContext.Provider value={contextValue}>
      {children}
    </ImageGenerationContext.Provider>
  );
}
