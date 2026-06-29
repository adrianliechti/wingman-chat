import { getConfig } from "@/shared/config";
import type { ImageRenderOptions } from "@/shared/lib/client";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getFileName } from "@/shared/lib/utils";
import { resolveModel } from "./commandUtils";
import type { RenderInput } from "./interpreterProtocol";

export async function runRenderImage(
  prompt: string,
  inputs: RenderInput[],
  options?: ImageRenderOptions,
): Promise<Uint8Array> {
  const config = getConfig();
  if (!config.renderer) {
    throw new Error("render: no image rendering service configured");
  }
  if (!prompt.trim()) {
    throw new Error("render: no prompt provided");
  }

  // Ship original filenames and content types — the backend routes uploads
  // by content type, like the extractor does for `ocr`.
  const images = inputs.map(({ data, path }) => {
    if (data.length === 0) {
      throw new Error(`render: file is empty: ${path}`);
    }
    const name = getFileName(path);
    const type = inferContentTypeFromPath(name);
    if (!type?.startsWith("image/")) {
      throw new Error(`render: not an image: ${name} — use a known image extension like .png or .jpg`);
    }
    return new File([data as BlobPart], name, { type });
  });

  const model = await resolveModel(config.renderer.model, "renderer");
  const blob = await config.client.generateImage(model, prompt, images, options);
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length === 0) {
    throw new Error("render: service returned an empty image");
  }
  console.debug(`render: ${inputs.length} input image(s) → ${data.length} bytes (${blob.type || "unknown type"})`);
  return data;
}
