import { assertByteLengthWithinLimit, readResponseBlobWithLimit } from "./boundedResponse";

export interface DriveEntry {
  id: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  mime?: string;
}

export interface DriveFileSelection {
  id: string;
  name: string;
  driveId: string;
  mime?: string;
  /** Provider metadata used only for early admission; streamed bytes win. */
  size?: number;
}

/** Finite fallback for remote files when the consuming feature has no cap. */
export const DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES = 128 * 1024 * 1024;

export async function listDriveEntries(driveId: string, id: string = ""): Promise<DriveEntry[]> {
  const params = new URLSearchParams();

  if (id) {
    params.set("id", id);
  }

  const resp = await fetch(`/api/v1/drives/${driveId}/entries?${params}`);

  if (!resp.ok) {
    throw new Error(`Failed to list files: ${resp.statusText}`);
  }

  return resp.json();
}

export function getDriveContentUrl(driveId: string, id: string): string {
  const params = new URLSearchParams({ id });
  return `/api/v1/drives/${driveId}/content?${params}`;
}

/** Download one selected Drive file without ever buffering beyond maxBytes. */
export async function downloadDriveFile(
  file: DriveFileSelection,
  maxBytes = DEFAULT_DRIVE_DOWNLOAD_MAX_BYTES,
): Promise<File> {
  if (file.size !== undefined) {
    assertByteLengthWithinLimit(file.size, maxBytes, `“${file.name}”`);
  }

  const response = await fetch(getDriveContentUrl(file.driveId, file.id));
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new Error(`Failed to download “${file.name}”: ${status}`);
  }

  const blob = await readResponseBlobWithLimit(response, maxBytes, `“${file.name}”`);
  return new File([blob], file.name, { type: file.mime || blob.type || "" });
}
