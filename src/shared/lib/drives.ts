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
