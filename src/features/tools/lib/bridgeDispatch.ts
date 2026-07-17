/**
 * Shared worker→main bridge dispatch for both interpreters: routes an RPC
 * request to the runner that owns it so neither interpreter client repeats the
 * switch.
 */

import { rasterizeSvg } from "@/shared/lib/svg";
import type { WorkerToMainMessage } from "./interpreterProtocol";
import { runLlm } from "./llmCommand";
import { runOcr } from "./ocrCommand";
import { runRenderImage } from "./renderCommand";
import { runSynthesize } from "./synthesizeCommand";
import { runTranscribe } from "./transcribeCommand";
import { runTranslateFile, runTranslateText } from "./translateCommand";
import { runVision } from "./visionCommand";

export function dispatchBridgeRpc(message: WorkerToMainMessage): Promise<unknown> {
  switch (message.type) {
    case "llm-request":
      return runLlm(message.prompt, message.options);
    case "ocr-request":
      return runOcr(message.data, message.path);
    case "vision-request":
      return runVision(message.data, message.path, message.prompt);
    case "render-request":
      return runRenderImage(message.prompt, message.inputs, message.options);
    case "synthesize-request":
      return runSynthesize(message.text, message.voice);
    case "transcribe-request":
      return runTranscribe(message.data, message.path);
    case "translate-text-request":
      return runTranslateText(message.lang, message.text);
    case "translate-file-request":
      return runTranslateFile(message.lang, message.data, message.path);
    case "pdf-rasterize-request":
      // Loaded on demand — pdf.js (~400 kB) stays out of the initial bundle.
      return import("@/shared/lib/pdf").then(({ rasterizePdf }) =>
        rasterizePdf(message.data, { pages: message.pages, scale: message.scale }),
      );
    case "svg-rasterize-request":
      return rasterizeSvg(message.svg, { width: message.width, height: message.height });
    default:
      return Promise.reject(new Error(`Unsupported bridge request: ${(message as { type: string }).type}`));
  }
}
