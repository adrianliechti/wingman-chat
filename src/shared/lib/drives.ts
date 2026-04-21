export interface DriveEntry {
  id: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  mime?: string;
}

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

export interface DriveFileEntry extends DriveEntry {
  path: string;
}

export async function listAllDriveFiles(driveId: string, folderId: string, folderName: string): Promise<DriveFileEntry[]> {
  const results: DriveFileEntry[] = [];

  async function walk(id: string, prefix: string) {
    const entries = await listDriveEntries(driveId, id);
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.kind === "directory") {
        await walk(entry.id, path);
      } else {
        results.push({ ...entry, path });
      }
    }
  }

  await walk(folderId, folderName);
  return results;
}
