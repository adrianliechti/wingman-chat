export interface SyncProgress {
  direction: "restore" | "backup";
  completed: number;
  /** Unknown while listing remote items or scanning local storage. */
  total: number | null;
}

/** Separate tasks keep overlapping pulls and uploads from replacing each other. */
export class SyncProgressTracker {
  private tasks = new Set<SyncProgress>();
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  get snapshot(): SyncProgress[] {
    return Array.from(this.tasks, (task) => ({ ...task }));
  }

  begin(direction: SyncProgress["direction"], total: number | null = null) {
    const task: SyncProgress = { direction, completed: 0, total };
    this.tasks.add(task);
    this.onChange();
    return {
      setTotal: (count: number) => {
        task.total = count;
        if (this.tasks.has(task)) this.onChange();
      },
      advance: () => {
        task.completed++;
        if (this.tasks.has(task)) this.onChange();
      },
      finish: () => {
        if (this.tasks.delete(task)) this.onChange();
      },
    };
  }
}

export function describeSyncProgress(progress: SyncProgress, unit: "chats" | "files"): string {
  if (progress.total === null) {
    return progress.direction === "restore" ? `Checking ${unit} for updates…` : `Preparing to back up ${unit}…`;
  }
  if (progress.total === 0) return `Finishing ${unit === "chats" ? "chat" : "file"} sync…`;

  const action = progress.direction === "restore" ? "Restoring" : "Backing up";
  return `${action} ${unit} · ${progress.completed} / ${progress.total}`;
}
