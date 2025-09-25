import { useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { ImageGenerationContext } from "./ImageGenerationContext";
import type { ImageGenerationContextType } from "./ImageGenerationContext";
import type { Tool, ToolContext } from "../types/chat";
import { AttachmentType } from "../types/chat";
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
              config.image?.model || "",
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

  const imageGenerationInstructions = useCallback((): string => {
    if (!isEnabled) {
      return "";
    }

    return `
      You have access to image generation and editing functionality.
      
      - Use the generate_image tool when the user asks you to create, generate, make, edit, or modify an image.
      - For new images: Create detailed and specific prompts describing the desired content, style, composition, colors, and other visual elements.
      - For editing images: If the user has attached images to the chat, you can edit them by describing the modifications or changes you want to make.
      - The tool automatically detects and uses any image attachments in the chat for editing purposes.
      - Consider the user's preferences for style, composition, colors, and other visual elements.
      
      Always use this tool when the user requests image creation, generation, editing, or modification of visual content.
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
