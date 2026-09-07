/**
 * Serialize complete artifact transactions per chat. Different chats remain
 * independent; Web Locks extend the guarantee across tabs when available.
 */
const localQueues = new Map<string, Promise<void>>();

async function withBrowserLock<T>(chatId: string, run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return run();
  return locks.request(`wingman:artifacts:${chatId}`, run);
}

export function withArtifactWorkspaceLock<T>(chatId: string, run: () => Promise<T>): Promise<T> {
  const previous = localQueues.get(chatId) ?? Promise.resolve();
  const result = previous.then(() => withBrowserLock(chatId, run));
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  localQueues.set(chatId, tail);
  void tail.then(() => {
    if (localQueues.get(chatId) === tail) localQueues.delete(chatId);
  });
  return result;
}
