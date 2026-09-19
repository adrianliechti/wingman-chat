import { Image } from "lucide-react";
import mime from "mime";
import { useCallback, useMemo, useRef } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { resolveArtifactFileSystem, type FileSystemManager } from "@/features/artifacts/lib/fs";
import { getConfig } from "@/shared/config";
import type { ImageRenderOptions } from "@/shared/lib/client";
import { isDataUrl } from "@/shared/lib/fileContent";
import { withRendererFallback } from "@/shared/lib/models";
import { readAsDataURL } from "@/shared/lib/utils";
import { artifactDelta } from "@/shared/types/artifact";
import type { TextContent, Tool, ToolContext } from "@/shared/types/chat";

function errorResult(error: string, context?: ToolContext): TextContent[] {
  context?.setError?.({ code: "IMAGE_GENERATION_ERROR", message: error });
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

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/**
 * The `create_image` tool — generate/edit an image via the configured renderer,
 * saving the result to the artifacts workspace and returning it inline.
 *
 * Available by default in chat when an image renderer is configured.
 */
export function useImageTool(): Tool | null {
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

  const buildTool = useCallback((): Tool => {
    const elicitation = config.renderer?.elicitation;
    const model = config.renderer?.model || "";
    const caps = withRendererFallback(config.models.find((entry) => entry.id === model) ?? { id: model, name: model });

    // Advertise only the controls this renderer honors — the same capability
    // mapping the Canvas pickers use — so the model isn't offered aspect ratios,
    // quality tiers, or a transparent background the configured model can't make.
    const properties: Record<string, unknown> = {
      prompt: {
        type: "string",
        description:
          "Describe the subject, composition, style, and any required text. Preserve the user's constraints; add visual detail where unspecified. For edits, state the changes and elements to preserve.",
      },
      images: {
        type: "array",
        items: { type: "string" },
        description:
          'Artifact paths for edit/reference images, e.g. ["/fox.png"]. Current-message image attachments are also included automatically; use paths for earlier images.',
      },
    };
    if (caps.supportedAspectRatios?.length) {
      properties.aspect_ratio = {
        type: "string",
        enum: caps.supportedAspectRatios,
        description:
          "Output shape. Choose a listed ratio that fits the intended placement, or omit for the renderer default.",
      };
    }
    if (caps.supportedQualities?.length) {
      properties.quality = {
        type: "string",
        enum: caps.supportedQualities,
        description:
          "Rendering quality; defaults to the first listed tier. Higher tiers usually take longer and cost more.",
      };
    }
    if (caps.supportedResolutions?.length) {
      properties.resolution = {
        type: "string",
        enum: caps.supportedResolutions,
        description:
          "Output resolution; omit for the renderer default. Use higher resolutions when needed for the final size or detail.",
      };
    }
    if (caps.supportedBackgrounds?.length) {
      properties.background = {
        type: "string",
        enum: caps.supportedBackgrounds,
        description:
          'Use "transparent" for cutouts or compositing, or "opaque" for a filled background. Omit for the renderer default.',
      };
    }

    return {
      name: "create_image",
      display: {
        header: (_args, state) => ({
          icon: Image,
          label: state.error ? "Image failed" : state.running ? "Generating image…" : "Created image",
        }),
      },
      description:
        "Generate or edit raster images such as photos, illustrations, and visual assets. Use for image creation and visual edits; use vision to inspect images and file/code tools for interactive HTML, SVG, or charts. Supply a self-contained prompt and artifact paths for reference images. Current-message image attachments are included automatically. Returns the image inline and saves it to the chat workspace when available.",
      parameters: {
        type: "object",
        properties,
        required: ["prompt"],
        additionalProperties: false,
      },
      function: async (args: Record<string, unknown>, context?: ToolContext) => {
        context?.signal?.throwIfAborted();
        const activeFs = resolveArtifactFileSystem(fsRef.current, context?.chatId);
        const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
        if (!prompt) return errorResult("`prompt` is required.", context);

        // Confirm before spending a generation when elicitation is enabled.
        if (elicitation) {
          if (!context?.elicit) {
            return errorResult(
              "Image generation requires confirmation, which is unavailable in this context.",
              context,
            );
          }
          const result = await context.elicit({ message: `Generate an image: ${prompt}` });
          context.signal?.throwIfAborted();
          if (result.action !== "accept") return errorResult("Image generation cancelled by user.", context);
        }

        try {
          // Reference images to edit or build on: explicit artifact paths, plus
          // any image attached to the current message. None → text-to-image.
          const references: Blob[] = [];
          const paths = Array.isArray(args.images) ? args.images.filter((p): p is string => typeof p === "string") : [];
          for (const path of paths) {
            const file = activeFs ? await activeFs.getFile(path) : undefined;
            if (!file || !isDataUrl(file.content)) return errorResult(`No image artifact found at ${path}.`, context);
            references.push(await blobFromDataUrl(file.content));
          }
          for (const part of context?.content?.() ?? []) {
            if (part.type === "image") references.push(await blobFromDataUrl(part.data));
          }

          const options: ImageRenderOptions = {};
          if (typeof args.aspect_ratio === "string") options.aspectRatio = args.aspect_ratio;
          // Default to a supported tier, including deployments that exclude low.
          if (caps.supportedQualities?.length) {
            options.quality =
              caps.supportedQualities.find((quality) => quality === args.quality) ?? caps.supportedQualities[0];
          }
          if (
            args.resolution === "512" ||
            args.resolution === "1K" ||
            args.resolution === "2K" ||
            args.resolution === "4K"
          ) {
            options.resolution = args.resolution;
          }
          if (args.background === "transparent" || args.background === "opaque") {
            options.background = args.background;
          }

          context?.signal?.throwIfAborted();
          const imageBlob = await client.generateImage(model, prompt, references, options, {
            signal: context?.signal,
          });
          const dataUrl = await readAsDataURL(imageBlob);
          context?.signal?.throwIfAborted();

          // Save to the artifacts workspace so the image is downloadable, editable
          // by path, and usable by the Python tool. Best-effort — a save
          // failure must not discard a successfully generated image.
          let name: string | undefined;
          if (activeFs) {
            try {
              const ext = mime.getExtension(imageBlob.type) || "png";
              const saved = await activeFs.ingestFiles(
                [
                  {
                    path: `/${slugify(prompt)}.${ext}`,
                    content: dataUrl,
                    contentType: imageBlob.type || `image/${ext}`,
                  },
                ],
                { origin: { actor: "assistant", runId: context?.runId, reason: "create" } },
              );
              context?.signal?.throwIfAborted();
              if (saved.mutations.length) {
                context?.setMeta?.({ artifactFiles: saved.paths, artifactDelta: artifactDelta(saved.mutations) });
              }
              name = saved.paths[0];
            } catch (error) {
              context?.signal?.throwIfAborted();
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
          context?.signal?.throwIfAborted();
          const message = error instanceof Error ? error.message : "Unknown error";
          return errorResult(`Image generation failed: ${message}`, context);
        }
      },
    };
  }, [client, config.models, config.renderer?.elicitation, config.renderer?.model]);

  return useMemo<Tool | null>(() => (isAvailable ? buildTool() : null), [isAvailable, buildTool]);
}
