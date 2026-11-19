// Kept apart from storeClient so tests that mock the client still share this class.
/** The backend stayed busy after retries. Sync keeps the work pending and
 * retries after `retryAfterMs` without reporting a backup error. */
export class BackupBusyError extends Error {
  readonly status = 503;
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}
