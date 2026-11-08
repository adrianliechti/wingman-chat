import { expect, it } from "vitest";
import { nativePhaseReplay } from "./test-support/tanstackPhases";

it("preserves native response item boundaries through UI persistence without a sidecar", async () => {
  const { saved, replay } = await nativePhaseReplay();
  expect(saved.at(-1)?.content).toBe("WorkingDone");
  expect(replay).toMatchObject([
    { id: "commentary", phase: "commentary", content: [{ text: "Working" }] },
    { id: "final", phase: "final_answer", content: [{ text: "Done" }] },
  ]);
});
