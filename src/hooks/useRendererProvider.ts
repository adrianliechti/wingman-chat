import { useCallback, useMemo } from "react";
import { Image } from 'lucide-react';
import { getConfig } from "../config";
import type { Tool, ToolContext, ToolProvider, ImageContent } from "../types/chat";
import { readAsDataURL } from "../lib/utils";
import rendererInstructionsText from '../prompts/renderer.txt?raw';

export function useRendererProvider(): ToolProvider | null {
  const config = getConfig();
  
  const isAvailable = useMemo(() => {
    try {
      return !!config.renderer;
    } catch (error) {
      console.warn('Failed to get image generation config:', error);
      return false;
    }
  }, [config.renderer]);

  const client = config.client;

  const rendererTools = useCallback((): Tool[] => {
    return [
      {
        name: "create_image",
        description: "Create a new image based on a text description.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A detailed description of the image to generate. Describe the desired content, style, composition, and colors."
            }
          },
          required: ["prompt"]
        },
        function: async (args: Record<string, unknown>, context?: ToolContext) => {
          const { prompt } = args;

          if (config.renderer?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Generate an image: ${prompt}`
            });

            if (result.action !== "accept") {
              return [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: "Image creation cancelled by user."
                })
              }];
            }
          }

          try {
            const imageBlob = await client.generateImage(
              config.renderer?.model || "",
              prompt as string,
              []
            );

            const dataUrl = await readAsDataURL(imageBlob);

            return [{
              type: "image" as const,
              data: dataUrl,
            }];
          } catch (error) {
            return [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: `Image creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              })
            }];
          }
        }
      },
      {
        name: "edit_image",
        description: "Edit an existing image based on a text description. Requires image attachments in the chat.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A description of the changes or modifications you want to make to the existing image."
            }
          },
          required: ["prompt"]
        },
        function: async (args: Record<string, unknown>, context?: ToolContext) => {
          const { prompt } = args;

          if (config.renderer?.elicitation && context?.elicit) {
            const result = await context.elicit({
              message: `Edit the attached image(s): ${prompt}`
            });

            if (result.action !== "accept") {
              return [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: "Image editing cancelled by user."
                })
              }];
            }
          }

          const images: Blob[] = [];

          // Extract image content from context
          if (context?.content) {
            const contents = context.content();
            const imageContents = contents.filter((c): c is ImageContent => c.type === 'image');
            
            for (const imageContent of imageContents) {
              try {
                const response = await fetch(imageContent.data);
                const blob = await response.blob();
                images.push(blob);
              } catch {
                // Failed to convert content
              }
            }
          }

          if (images.length === 0) {
            return [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'No image attachments found. Please attach an image to edit.'
              })
            }];
          }

          try {
            const imageBlob = await client.generateImage(
              config.renderer?.model || "",
              prompt as string,
              images
            );

            const dataUrl = await readAsDataURL(imageBlob);

            return [{
              type: "image" as const,
              data: dataUrl,
            }];
          } catch (error) {
            return [{
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: `Image editing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              })
            }];
          }
        }
      }
    ];
  }, [client, config.renderer?.elicitation, config.renderer?.model]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "renderer",
      name: "Image Editor",
      description: "Create and edit images",
      icon: Image,
      instructions: rendererInstructionsText,
      tools: rendererTools(),
    };
  }, [isAvailable, rendererTools]);

  return provider;
}
