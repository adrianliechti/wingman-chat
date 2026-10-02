import type JSZip from "jszip";
import { downloadBlob } from "./utils";

type Progress = (fraction: number) => void;
const ZIP_TYPE = "application/zip";

/** Bridge JSZip's pause/resume API to a stream with backpressure. */
function readable(
  helper: JSZip.JSZipStreamHelper<Uint8Array>,
  onProgress?: Progress,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let stopped = false;
  return new ReadableStream({
    start(controller) {
      helper.on("data", (data, metadata) => {
        if (stopped) return;
        controller.enqueue(new Uint8Array(data));
        onProgress?.(metadata.percent / 100);
        if (controller.desiredSize! <= 0) helper.pause();
      });
      helper.on("error", (error) => {
        if (!stopped) {
          stopped = true;
          controller.error(error);
        }
      });
      helper.on("end", () => {
        if (!stopped) {
          stopped = true;
          controller.close();
        }
      });
    },
    pull() {
      helper.resume();
    },
    cancel() {
      stopped = true;
      helper.pause();
    },
  });
}

function zipStream(zip: JSZip, onProgress?: Progress) {
  return readable(
    zip.generateInternalStream({ type: "uint8array", compression: "DEFLATE", streamFiles: true }),
    onProgress,
  );
}

/** Build a Blob from chunks without JSZip concatenating a second full byte array. */
export function generateZipBlob(zip: JSZip, onProgress?: Progress): Promise<Blob> {
  return new Response(zipStream(zip, onProgress), { headers: { "Content-Type": ZIP_TYPE } }).blob();
}

export function readZipEntryBlob(entry: JSZip.JSZipObject): Promise<Blob> {
  // JSZip exposes this API at runtime but omits it from JSZipObject's types.
  const streamable = entry as JSZip.JSZipObject & {
    internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
  };
  return new Response(readable(streamable.internalStream("uint8array"))).blob();
}

/** Open the picker before snapshot/compression work can consume the user gesture. */
export async function downloadZip(
  filename: string,
  createZip: () => Promise<JSZip>,
  onProgress?: Progress,
): Promise<void> {
  const picker =
    typeof window === "undefined"
      ? undefined
      : (
          window as Window & {
            showSaveFilePicker?: (options: {
              suggestedName: string;
              types: { accept: Record<string, string[]> }[];
            }) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker;
  let handle: FileSystemFileHandle | undefined;
  if (picker) {
    try {
      handle = await picker.call(window, { suggestedName: filename, types: [{ accept: { [ZIP_TYPE]: [".zip"] } }] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Embedded/restricted contexts may expose the picker without allowing it.
      if (!(error instanceof DOMException) || !["SecurityError", "NotAllowedError"].includes(error.name)) throw error;
    }
  }
  const writable = await handle?.createWritable();
  try {
    const zip = await createZip();
    if (writable) await zipStream(zip, onProgress).pipeTo(writable);
    else await downloadBlob(await generateZipBlob(zip, onProgress), filename, { usePicker: false });
  } catch (error) {
    await writable?.abort(error).catch(() => {});
    throw error;
  }
}
