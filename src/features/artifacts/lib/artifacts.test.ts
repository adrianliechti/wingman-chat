import { describe, expect, it } from "vitest";
import { artifactKind } from "./artifacts";

describe("artifact extension classification", () => {
  it("does not treat extensionless names or dotfiles as extensions", () => {
    expect(artifactKind("csv")).toBe("text");
    expect(artifactKind("/.csv")).toBe("text");
    expect(artifactKind("/report.csv")).toBe("csv");
  });

  it("still lets an explicit content type select the editor", () => {
    expect(artifactKind("/report", "text/csv")).toBe("csv");
  });
});
