import { describe, expect, it } from "vitest";
import { collectReferencedLibraries, exportArtifactHtmlForFolder, findLibraryReferences } from "./exportArtifactHtml";

const load = async (name: string) => (name === "echarts.js" ? "var echarts=1;" : undefined);

describe("folder exports", () => {
  it("finds library references relative and absolute, at any depth", () => {
    const html = `<script src="/.lib/echarts.js"></script><script src='../.lib/three.js'></script><script src="app.js"></script>`;
    expect(findLibraryReferences(html, "/pages/a.html")).toEqual([
      { name: "echarts.js", resolved: "/.lib/echarts.js" },
      { name: "three.js", resolved: "/.lib/three.js" },
    ]);
  });

  it("makes absolute references relative to the page so the folder works from disk", () => {
    expect(exportArtifactHtmlForFolder('<script src="/.lib/echarts.js"></script>', "/pages/a.html")).toBe(
      '<script src="../.lib/echarts.js"></script>',
    );
    expect(exportArtifactHtmlForFolder('<script src="/.lib/echarts.js"></script>', "/index.html")).toBe(
      '<script src=".lib/echarts.js"></script>',
    );
  });

  it("collects each referenced library once per resolved path and skips unknown names", async () => {
    const files = [
      { path: "/index.html", content: '<script src="/.lib/echarts.js"></script>' },
      { path: "/pages/b.html", content: '<script src="../.lib/echarts.js"></script><script src="../.lib/nope.js"></script>' },
      { path: "/pages/c.html", content: '<script src=".lib/echarts.js"></script>' },
      { path: "/notes.md", content: '<script src="/.lib/echarts.js"></script>' },
    ];
    expect(await collectReferencedLibraries(files, load)).toEqual(
      new Map([
        ["/.lib/echarts.js", "var echarts=1;"],
        ["/pages/.lib/echarts.js", "var echarts=1;"],
      ]),
    );
  });
});
