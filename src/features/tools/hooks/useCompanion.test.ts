import { expect, it } from "vitest";
import { companionMcpUrl, companionUrl } from "./useCompanion";
it.each(["http://localhost:4242", "http://localhost:4242/"])(
  "joins companion endpoints without double slashes: %s",
  (base) => {
    expect(companionMcpUrl(base)).toBe("http://localhost:4242/mcp");
    expect(companionUrl(base, "/.well-known/wingman-configuration")).toBe(
      "http://localhost:4242/.well-known/wingman-configuration",
    );
  },
);
it("preserves a deployment prefix and query while joining endpoint paths", () => {
  expect(companionMcpUrl("https://example.test/companion/?tenant=one#ignored")).toBe(
    "https://example.test/companion/mcp?tenant=one",
  );
});
