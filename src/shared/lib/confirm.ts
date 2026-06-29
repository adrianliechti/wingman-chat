// Imperative, promise-based confirm dialog — callable from anywhere (components
// and plain modules), mirroring the global `notify`/sonner pattern. The UI is
// rendered once by <ConfirmHost/>, which subscribes to this store.

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Subscribe to changes (used by <ConfirmHost/>). Returns an unsubscribe fn. */
export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pending request, or null. The host reads option fields only. */
export function getConfirmRequest(): ConfirmOptions | null {
  return current;
}

/** Resolve the open confirm (called by the host on the user's choice). */
export function settleConfirm(confirmed: boolean): void {
  const request = current;
  current = null;
  emit();
  request?.resolve(confirmed);
}

/** Ask the user to confirm. Resolves true when confirmed. */
export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { title: options } : options;
  // Auto-cancel anything already open (last request wins).
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { ...opts, resolve };
    emit();
  });
}
