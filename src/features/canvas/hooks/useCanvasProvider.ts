import { Image } from "lucide-react";
import mime from "mime";
import { useCallback, useMemo, useRef } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import canvasInstructionsText from "@/features/canvas/prompts/canvas.txt?raw";
import { getConfig } from "@/shared/config";
import { isDataUrl } from "@/shared/lib/fileContent";
import { readAsDataURL } from "@/shared/lib/utils";
import type { TextContent, Tool, ToolContext, ToolProvider } from "@/shared/types/chat";

function errorResult(error: string): TextContent[] {
  return [{ type: "text", text: JSON.stringify({ success: false, error }) }];
}

/** Turn a prompt into a short, filesystem-safe slug (falls back to "image"). */
function slugify(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "image";
}

/** Find an unused `/<slug>[-N].<ext>` path so generations never overwrite. */
async function uniqueImagePath(fs: FileSystemManager, slug: string, ext: string): Promise<string> {
  const base = `/${slug}`;
  let path = `${base}.${ext}`;
  let n = 1;
  while (await fs.fileExists(path)) {
    path = `${base}-${n}.${ext}`;
    n += 1;
  }
  return path;
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export function useCanvasProvider(): ToolProvider | null {
  const config = getConfig();
  const { fs } = useArtifacts();

  // The tool function is compiled once but executes later (after a network
  // round trip), so route `fs` through a ref to always read the latest value at
  // execution time — the filesystem can be created mid-send for a new chat.
  const fsRef = useRef<FileSystemManager | null>(fs);
  fsRef.current = fs;

  const isAvailable = useMemo(() => {
    try {
      return !!config.renderer;
    } catch (error) {
      console.warn("Failed to get image generation config:", error);
      return false;
    }
  }, [config.renderer]);

  const client = config.client;

  const canvasTools = useCallback((): Tool[] => {
    const elicitation = config.renderer?.elicitation;
    const model = config.renderer?.model || "";

    return [
      {
        name: "create_image",
        display: {
          header: (_args, state) => ({
            icon: Image,
            label: state.error ? "Image failed" : state.running ? "Generating image…" : "Created image",
          }),
        },
        description:
          "Generate an image from a text description. Optionally provide reference images to edit or build on: pass `images` (paths to image artifacts) and/or attach images to the chat. The result is saved as an artifact and returned inline.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The image request in the user's own words. Pass it through faithfully — preserve their intent and do not invent style, lighting, or details they did not ask for. Resolve only contextual references (e.g. what 'it' refers to). When reference images are provided, describe just the changes to make.",
            },
            images: {
              type: "array",
              items: { type: "string" },
              description:
                'Optional paths to image artifacts to use as references, e.g. ["/a-red-fox.png"]. Images attached to the current message are used automatically.',
            },
          },
          required: ["prompt"],
        },
        function: async (args: Record<string, unknown>, context?: ToolContext) => {
          const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
          if (!prompt) return errorResult("`prompt` is required.");

          // Confirm before spending a generation when elicitation is enabled.
          if (elicitation && context?.elicit) {
            const result = await context.elicit({ message: `Generate an image: ${prompt}` });
            if (result.action !== "accept") return errorResult("Image generation cancelled by user.");
          }

          try {
            // Reference images to edit or build on: explicit artifact paths, plus
            // any image attached to the current message. None → text-to-image.
            const references: Blob[] = [];
            const paths = Array.isArray(args.images)
              ? args.images.filter((p): p is string => typeof p === "string")
              : [];
            for (const path of paths) {
              const file = fsRef.current ? await fsRef.current.getFile(path) : undefined;
              if (!file || !isDataUrl(file.content)) return errorResult(`No image artifact found at ${path}.`);
              references.push(await blobFromDataUrl(file.content));
            }
            for (const part of context?.content?.() ?? []) {
              if (part.type === "image") references.push(await blobFromDataUrl(part.data));
            }

            const imageBlob = await client.generateImage(model, prompt, references);
            const dataUrl = await readAsDataURL(imageBlob);

            // Save to the artifacts workspace so the image is downloadable, editable
            // by path, and usable by the Python/Bash tools. Best-effort — a save
            // failure must not discard a successfully generated image.
            let name: string | undefined;
            const activeFs = fsRef.current;
            if (activeFs) {
              try {
                const ext = mime.getExtension(imageBlob.type) || "png";
                const path = await uniqueImagePath(activeFs, slugify(prompt), ext);
                await activeFs.createFile(path, dataUrl, imageBlob.type || `image/${ext}`);
                name = path;
              } catch (error) {
                console.warn("Failed to save generated image to artifacts:", error);
              }
            }

            // Return the image inline. The harness strips it to a text placeholder
            // before the model (serializeToolResultForApi) and persists it as a blob
            // reference, not base64 — so it bloats neither context nor storage. The
            // placeholder keeps `name`, so the model learns the artifact path and can
            // reference it to edit the image later.
            return [{ type: "image" as const, data: dataUrl, name }];
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return errorResult(`Image generation failed: ${message}`);
          }
        },
      },
    ];
  }, [client, config.renderer?.elicitation, config.renderer?.model]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "canvas",
      name: "Image",
      description: "Generate and edit images",
      icon: Image,
      instructions: canvasInstructionsText,
      tools: canvasTools(),
    };
  }, [isAvailable, canvasTools]);

  return provider;
}
