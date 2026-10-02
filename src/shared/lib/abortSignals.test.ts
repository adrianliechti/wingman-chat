import { describe, expect, it } from "vitest";
import { followAbortSignal } from "./abortSignals";

describe("followAbortSignal", () => {
  it.each([true, false])("preserves the parent's reason when already aborted is %s", (alreadyAborted) => {
    const parent = new AbortController();
    const reason = new Error("The chat was stopped");
    if (alreadyAborted) parent.abort(reason);
    const { controller, cleanup } = followAbortSignal(parent.signal);
    try {
      if (!alreadyAborted) {
        expect(controller.signal.aborted).toBe(false);
        parent.abort(reason);
      }
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe(reason);
    } finally {
      cleanup();
    }
  });

  it("stops following the parent after cleanup", () => {
    const parent = new AbortController();
    const { controller, cleanup } = followAbortSignal(parent.signal);
    cleanup();
    cleanup();
    parent.abort(new Error("A later request was stopped"));
    expect(controller.signal.aborted).toBe(false);
  });

  it("lets a child cancel without aborting its parent or sibling", () => {
    const parent = new AbortController();
    const first = followAbortSignal(parent.signal);
    const second = followAbortSignal(parent.signal);
    try {
      first.controller.abort(new Error("Summary finished"));
      expect(parent.signal.aborted).toBe(false);
      expect(second.controller.signal.aborted).toBe(false);
      parent.abort(new Error("Chat stopped"));
      expect(second.controller.signal.reason).toBe(parent.signal.reason);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });
});
