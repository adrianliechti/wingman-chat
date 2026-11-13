import { expect, it } from "vitest";
import { describeSyncProgress, SyncProgressTracker } from "./syncProgress";

it("keeps overlapping restore and backup progress independent", () => {
  const tracker = new SyncProgressTracker(() => {});
  const restore = tracker.begin("restore");
  const backup = tracker.begin("backup", 3);
  const earlier = tracker.snapshot;
  restore.setTotal(2);
  restore.advance();
  backup.advance();
  expect(earlier).toEqual([
    { direction: "restore", total: null, completed: 0 },
    { direction: "backup", total: 3, completed: 0 },
  ]);
  restore.finish();
  // A late completion after an error must not resurrect an ended task.
  restore.advance();
  expect(tracker.snapshot).toEqual([{ direction: "backup", total: 3, completed: 1 }]);
  backup.finish();
  expect(tracker.snapshot).toEqual([]);
});

it("describes discovery separately from counted transfers", () => {
  expect(describeSyncProgress({ direction: "restore", total: null, completed: 0 }, "chats")).toBe(
    "Preparing to restore chats…",
  );
  expect(describeSyncProgress({ direction: "backup", total: 40, completed: 12 }, "files")).toBe(
    "Backing up files · 12 / 40",
  );
});
