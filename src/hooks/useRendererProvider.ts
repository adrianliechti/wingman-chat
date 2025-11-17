import { useState, useCallback, useMemo } from "react";
import { Image } from 'lucide-react';
import { getConfig } from "../config";
import type { Tool, ToolContext, ToolProvider } from "../types/chat";
import { AttachmentType } from "../types/chat";
import { readAsDataURL } from "../lib/utils";
import type { Resource } from "../lib/resource";
import rendererInstructionsText from '../prompts/image-generation.txt?raw';

export function useRendererProvider(): ToolProvider | null {
  const [isEnabled, setEnabled] = useState(false);
  const config = getConfig();
  
  const isAvailable = useMemo(() => {
    try {
      return config.renderer.enabled;
    } catch (error) {
      console.warn('Failed to get image generation config:', error);
      return false;
    }
  }, [config.renderer.enabled]);

  const client = config.client;

  const rendererTools = useCallback((): Tool[] => {
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
              } catch {
                // Failed to convert attachment
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
            return JSON.stringify({
              success: false,
              error: `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
          }
        }
      }
    ];
  }, [isEnabled, client, config]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "renderer",
      name: "Renderer",
      description: "Generate or edit images",
      icon: Image,
      instructions: rendererInstructionsText,
      tools: async () => rendererTools(),
      isEnabled: isEnabled,
      isInitializing: false,
      setEnabled: setEnabled,
    };
  }, [isAvailable, isEnabled, rendererTools]);

  return provider;
}
