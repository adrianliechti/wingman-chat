export interface DriveEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  mime?: string;
}

export async function listDriveEntries(driveId: string, path: string = ""): Promise<DriveEntry[]> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);

  const resp = await fetch(`/drives/${driveId}/list?${params}`);

  if (!resp.ok) {
    throw new Error(`Failed to list files: ${resp.statusText}`);
  }

  return resp.json();
}

export function getDriveContentUrl(driveId: string, path: string): string {
  const params = new URLSearchParams({ path });
  return `/drives/${driveId}/content?${params}`;
}
