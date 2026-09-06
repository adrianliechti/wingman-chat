import { rebuildFolderIndex, STORAGE_COLLECTIONS } from "@/shared/lib/opfs-index";
import { flushPersistence } from "@/shared/lib/persistence";

export interface RebuildIndexesResult {
  chats: number;
  agents: number;
  images: number;
  skills: number;
}

export async function rebuildAllIndexes(): Promise<RebuildIndexesResult> {
  await flushPersistence();
  const results = await Promise.all(
    STORAGE_COLLECTIONS.map(async (collection) => [collection, (await rebuildFolderIndex(collection)).length] as const),
  );
  return Object.fromEntries(results) as unknown as RebuildIndexesResult;
}
