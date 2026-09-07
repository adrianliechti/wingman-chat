import { describe, expect, it } from "vitest";
import { withArtifactWorkspaceLock } from "./workspaceCoordinator";

describe("artifact workspace coordinator", () => {
  it("serializes work for one chat even when a prior operation fails", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withArtifactWorkspaceLock("same", async () => {
      events.push("first:start");
      await gate;
      events.push("first:end");
      throw new Error("expected");
    });
    const second = withArtifactWorkspaceLock("same", async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    release();
    await expect(first).rejects.toThrow("expected");
    await second;
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("does not serialize unrelated chats", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withArtifactWorkspaceLock("one", async () => {
      events.push("one:start");
      await gate;
      events.push("one:end");
    });
    const second = withArtifactWorkspaceLock("two", async () => {
      events.push("two");
    });

    await second;
    expect(events).toEqual(["one:start", "two"]);
    release();
    await first;
  });
});
