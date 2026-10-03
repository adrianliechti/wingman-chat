import { z } from "zod";
import { Image } from "lucide-react";
import mime from "mime";
import { useMemo } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { resolveArtifactFileSystem, type FileSystemManager } from "@/features/artifacts/lib/fs";
import { getConfig } from "@/shared/config";
import type { ImageRenderOptions } from "@/shared/lib/client";
import { isDataUrl } from "@/shared/lib/fileContent";
import { withRendererFallback } from "@/shared/lib/models";
import { pickModel } from "@/shared/lib/modelSelection";
import { useModelCatalog } from "@/shared/hooks/useModelCatalog";
import { readAsDataURL } from "@/shared/lib/utils";
import { artifactDelta } from "@/shared/types/artifact";
import type { ContentPart } from "@tanstack/ai";
import { mediaDataUrl, mediaFromDataUrl } from "@/shared/lib/messages";
import type { Tool, ToolContext } from "@/shared/types/chat";

function errorResult(error: string, context?: ToolContext): ContentPart[] {
  context?.setError?.({ code: "IMAGE_GENERATION_ERROR", message: error });
  return [{ type: "text", content: JSON.stringify({ success: false, error }) }];
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

type Config = ReturnType<typeof getConfig>;

interface ImageToolOptions {
  client: Config["client"];
  catalog: ReturnType<typeof useModelCatalog>;
  models: Config["models"];
  rendererModel?: string;
  elicitation?: NonNullable<Config["renderer"]>["elicitation"];
  /** May be stale (e.g. a chat created mid-send); the call's `chatId` takes precedence. */
  fs: FileSystemManager | null;
}

function createImageTool({ client, catalog, models, rendererModel, elicitation, fs }: ImageToolOptions): Tool {
  const model = pickModel(catalog, rendererModel, "renderer");
  // The catalog may not have loaded yet, or may type a configured alias
  // differently — config overrides still carry the renderer's capabilities.
  const entry = catalog.find((m) => m.id === model) ?? models.find((m) => m.id === model);
  const caps = withRendererFallback(entry ?? { id: model, name: model });

  // Advertise only the controls this renderer honors — the same capability
  // mapping the Canvas pickers use — so the model isn't offered aspect ratios,
  // quality tiers, or a transparent background the configured model can't make.
  const properties: Record<string, z.ZodType> = {
    prompt: z
      .string()
      .describe(
        "Describe the subject, composition, style, and any required text. Preserve the user's constraints; add visual detail where unspecified. For edits, state the changes and elements to preserve.",
      ),
    images: z
      .array(z.string())
      .optional()
      .describe(
        'Artifact paths for edit/reference images, e.g. ["/fox.png"]. Current-message image attachments are also included automatically; use paths for earlier images.',
      ),
  };
  if (caps.supportedAspectRatios?.length) {
    properties.aspect_ratio = z
      .enum(caps.supportedAspectRatios)
      .optional()
      .describe(
        "Output shape. Choose a listed ratio that fits the intended placement, or omit for the renderer default.",
      );
  }
  if (caps.supportedQualities?.length) {
    properties.quality = z
      .enum(caps.supportedQualities)
      .optional()
      .describe(
        "Rendering quality; defaults to the first listed tier. Higher tiers usually take longer and cost more.",
      );
  }
  if (caps.supportedResolutions?.length) {
    properties.resolution = z
      .enum(caps.supportedResolutions)
      .optional()
      .describe(
        "Output resolution; omit for the renderer default. Use higher resolutions when needed for the final size or detail.",
      );
  }
  if (caps.supportedBackgrounds?.length) {
    properties.background = z
      .enum(caps.supportedBackgrounds)
      .optional()
      .describe(
        'Use "transparent" for cutouts or compositing, or "opaque" for a filled background. Omit for the renderer default.',
      );
  }

  return {
    name: "create_image",
    needsApproval: elicitation,
    display: {
      header: (_args, state) => ({
        icon: Image,
        label: state.error ? "Image failed" : state.running ? "Generating image…" : "Created image",
      }),
    },
    description:
      "Generate or edit raster images such as photos, illustrations, and visual assets. Use for image creation and visual edits; use vision to inspect images and file/code tools for interactive HTML, SVG, or charts. Supply a self-contained prompt and artifact paths for reference images. Current-message image attachments are included automatically. Returns the image inline and saves it to the chat workspace when available.",
    inputSchema: z.strictObject(properties),
    execute: async (args: Record<string, unknown>, execution) => {
      const context = execution?.context;
      context?.signal?.throwIfAborted();
      const activeFs = resolveArtifactFileSystem(fs, context?.chatId);
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) return errorResult("`prompt` is required.", context);

      // Confirm before spending a generation when elicitation is enabled.
      if (elicitation && !context?.interruptible) {
        if (!context?.elicit) {
          return errorResult("Image generation requires confirmation, which is unavailable in this context.", context);
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
          const dataUrl = part.type === "image" ? mediaDataUrl(part) : undefined;
          if (dataUrl) references.push(await blobFromDataUrl(dataUrl));
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
        return [mediaFromDataUrl(dataUrl, name, "image")];
      } catch (error) {
        context?.signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : "Unknown error";
        return errorResult(`Image generation failed: ${message}`, context);
      }
    },
  };
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

  const isAvailable = !!config.renderer;

  const client = config.client;
  const catalog = useModelCatalog();

  const elicitation = config.renderer?.elicitation;
  const rendererModel = config.renderer?.model;
  const models = config.models;
  return useMemo<Tool | null>(
    () => (isAvailable ? createImageTool({ client, catalog, models, rendererModel, elicitation, fs }) : null),
    [isAvailable, client, catalog, models, rendererModel, elicitation, fs],
  );
}
