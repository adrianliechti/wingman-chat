import { describe, expect, it } from "vitest";
import { isLibraryFolderPath, libraryNameFromPath, resolveArtifactReference } from "./artifactLibraries";

describe("artifact libraries", () => {
  it("recognises the reserved folder and library names at any depth", () => {
    expect(isLibraryFolderPath("/.lib")).toBe(true);
    expect(isLibraryFolderPath("/.lib/echarts.js")).toBe(true);
    expect(isLibraryFolderPath("/.libs/x.js")).toBe(false);
    expect(isLibraryFolderPath("/lib/echarts.js")).toBe(false);
    expect(libraryNameFromPath("/.lib/echarts.js")).toBe("echarts.js");
    expect(libraryNameFromPath("/pages/.lib/three.js")).toBe("three.js");
    expect(libraryNameFromPath("/lib/echarts.js")).toBeNull();
    expect(libraryNameFromPath("/.lib/sub/x.js")).toBeNull();
  });

  it("resolves references relative to the page", () => {
    expect(resolveArtifactReference("/index.html", ".lib/echarts.js")).toBe("/.lib/echarts.js");
    expect(resolveArtifactReference("/pages/a.html", "../.lib/three.js")).toBe("/.lib/three.js");
    expect(resolveArtifactReference("/pages/a.html", "./app.js?v=2")).toBe("/pages/app.js");
    expect(resolveArtifactReference("/pages/a.html", "/assets/x.css")).toBe("/assets/x.css");
    expect(resolveArtifactReference("/a.html", "https://cdn.example/x.js")).toBeNull();
    expect(resolveArtifactReference("/a.html", "data:text/javascript,1")).toBeNull();
    expect(resolveArtifactReference("/a.html", "#top")).toBeNull();
  });
});

describe("absolute library references", () => {
  it("rewrites /.lib/ attributes to a target prefix and leaves relative ones", async () => {
    const { rewriteAbsoluteLibraryReferences, relativePrefixToRoot } = await import("./artifactLibraries");
    const html = `<script src="/.lib/echarts.js"></script><link href='/.lib/x.css'><script src="../.lib/three.js"></script><p>/.lib/ in text</p>`;
    expect(rewriteAbsoluteLibraryReferences(html, "/__preview__/tok/")).toBe(
      `<script src="/__preview__/tok/.lib/echarts.js"></script><link href='/__preview__/tok/.lib/x.css'><script src="../.lib/three.js"></script><p>/.lib/ in text</p>`,
    );
    expect(relativePrefixToRoot("/index.html")).toBe("");
    expect(relativePrefixToRoot("/pages/deep/a.html")).toBe("../../");
    expect(rewriteAbsoluteLibraryReferences('<script src="/.lib/a.js">', relativePrefixToRoot("/pages/a.html"))).toBe(
      '<script src="../.lib/a.js">',
    );
  });
});
