import { describe, expect, it } from "vitest";
import { injectSdkScript, sdkScriptUrl } from "./inject";
import { emptyCapabilities } from "./protocol";

const options = { token: "tok en", path: "/index.html", capabilities: { ...emptyCapabilities(), files: true } };

describe("injectSdkScript", () => {
  it("places the script first inside an existing head", () => {
    const out = injectSdkScript('<!doctype html><html><head lang="en"><title>x</title></head><body></body></html>', options);
    expect(out.indexOf(sdkScriptUrl("tok en"))).toBeLessThan(out.indexOf("<title>"));
    expect(out).toContain('data-path="/index.html"');
    expect(out).toContain('data-capabilities="{&quot;llm&quot;:false');
    expect(out).toContain("__wingman__/sdk.js");
  });

  it("creates a head when only html exists and prepends otherwise", () => {
    expect(injectSdkScript("<html><body>hi</body></html>", options)).toMatch(/^<html><head><script /);
    expect(injectSdkScript("<p>fragment</p>", options)).toMatch(/^<script .*<\/script><p>fragment<\/p>$/);
  });

  it("is idempotent for the same session", () => {
    const once = injectSdkScript("<html><head></head></html>", options);
    expect(injectSdkScript(once, options)).toBe(once);
  });

  it("escapes attribute values", () => {
    const out = injectSdkScript("<html><head></head></html>", { ...options, path: '/a"b<c>.html' });
    expect(out).toContain('data-path="/a&quot;b&lt;c&gt;.html"');
  });
});
