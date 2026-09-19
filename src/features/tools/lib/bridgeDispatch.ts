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
import type { BridgeRequestOptions } from "./workerHost";

export function dispatchBridgeRpc(message: WorkerToMainMessage, options: BridgeRequestOptions = {}): Promise<unknown> {
  switch (message.type) {
    case "llm-request":
      return runLlm(message.prompt, message.options, options);
    case "ocr-request":
      return runOcr(message.data, message.path, options);
    case "vision-request":
      return runVision(message.data, message.path, message.prompt, options);
    case "render-request":
      return runRenderImage(message.prompt, message.inputs, message.options, options);
    case "synthesize-request":
      return runSynthesize(message.text, message.voice, options);
    case "transcribe-request":
      return runTranscribe(message.data, message.path, options);
    case "translate-text-request":
      return runTranslateText(message.lang, message.text, options);
    case "translate-file-request":
      return runTranslateFile(message.lang, message.data, message.path, options);
    case "pdf-rasterize-request":
      // Loaded on demand — pdf.js (~400 kB) stays out of the initial bundle.
      return import("@/shared/lib/pdf").then(({ rasterizePdf }) =>
        rasterizePdf(message.data, { pages: message.pages, scale: message.scale }),
      );
    case "svg-rasterize-request":
      return rasterizeSvg(message.svg, { width: message.width, height: message.height });
    case "duckdb-query-request": {
      // SQL over the run's workspace; DuckDB and the mount load on first use.
      const chatId = options.context?.chatId;
      if (!chatId) return Promise.reject(new Error("sql: no workspace for this run"));
      return import("@/features/artifacts/lib/duckdbWorkspace").then(({ queryDuckDbWorkspace }) =>
        queryDuckDbWorkspace(chatId, message.sql, message.params),
      );
    }
    default:
      return Promise.reject(new Error(`Unsupported bridge request: ${(message as { type: string }).type}`));
  }
}
