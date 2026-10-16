import type JSZip from "jszip";
import { notify } from "./notify";
import { downloadBlob } from "./utils";

type Progress = (fraction: number) => void;
const ZIP_TYPE = "application/zip";
/** Allow a transient file lock to clear before retrying. */
const WRITE_RETRY_DELAY_MS = 500;

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
  const zip = await createZip();
  if (handle) {
    // Open the output after the snapshot to shorten the lifetime of its staging file.
    if (await writeToFile(handle, zip, onProgress)) return;
  }
  onProgress?.(0);
  await downloadBlob(await generateZipBlob(zip, onProgress), filename, { usePicker: false });
  if (handle) {
    notify.warning("Archive download started", "The chosen file could not be written. Check your browser downloads.");
  }
}

/** Retry browser write failures once, then let the caller download the archive. */
async function writeToFile(handle: FileSystemFileHandle, zip: JSZip, onProgress?: Progress): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    let writable: FileSystemWritableFileStream | undefined;
    onProgress?.(0);
    try {
      writable = await handle.createWritable();
      await zipStream(zip, onProgress).pipeTo(writable);
      return true;
    } catch (error) {
      // Closing after a failed write can commit a truncated archive.
      await writable?.abort(error).catch(() => {});
      if (!(error instanceof DOMException)) throw error;
      if (attempt > 0) {
        console.warn("Could not write the archive to the chosen file:", error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_DELAY_MS));
    }
  }
}
