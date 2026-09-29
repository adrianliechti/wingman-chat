import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FileSystemManager } from "./fs";
import { verifyArtifacts } from "./artifact-verifier";

const CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PRESENTATION = "http://schemas.openxmlformats.org/presentationml/2006/main";

function relationships(...entries: string[]): string {
  return `<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${entries.join("")}</Relationships>`;
}

async function pptxDataUrl(): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="${CONTENT_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships(`<Relationship Id="mainDeck" Type="${RELATIONSHIPS}/officeDocument" Target="ppt/presentation.xml"/>`),
  );
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${RELATIONSHIPS}"><p:sldIdLst><p:sldId id="256" r:id="coverSlide"/><p:sldId id="257" r:id="closingSlide"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relationships(
      `<Relationship Id="coverSlide" Type="${RELATIONSHIPS}/slide" Target="slides/cover.xml"/>`,
      `<Relationship Id="closingSlide" Type="${RELATIONSHIPS}/slide" Target="slides/closing.xml"/>`,
    ),
  );
  zip.file("ppt/slides/cover.xml", `<p:sld xmlns:p="${PRESENTATION}"/>`);
  zip.file("ppt/slides/closing.xml", `<p:sld xmlns:p="${PRESENTATION}"/>`);
  return `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${await zip.generateAsync({ type: "base64" })}`;
}

describe("artifact OOXML verification", () => {
  it("verifies authored PPTX slides through package relationships", async () => {
    const path = "/deck.pptx";
    const file = {
      path,
      content: await pptxDataUrl(),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const fs = { listEntries: async () => [file], getFile: async () => file };
    const checks = await verifyArtifacts(fs, [path]);
    expect(checks.every((item) => item.status === "pass")).toBe(true);
    expect(checks).toContainEqual(expect.objectContaining({ id: "ooxml.package", status: "pass" }));
    expect(checks).toContainEqual(
      expect.objectContaining({
        id: "pptx.slides",
        status: "pass",
        message: "PPTX declares 2 logical slide(s).",
      }),
    );
  });
});

describe("html library references", () => {
  // Node has no DOMParser; a tag-level stand-in covers the selectors verifyHtml uses.
  class FakeDOMParser {
    parseFromString(html: string) {
      const attributes = (raw: string) => (name: string) => {
        const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(raw);
        return match ? (match[1] ?? match[2] ?? "") : null;
      };
      return {
        documentElement: {},
        querySelectorAll(selector: string) {
          if (selector.startsWith("script:not")) {
            return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
              .filter((match) => attributes(match[1])("src") === null)
              .map((match) => ({ textContent: match[2] }));
          }
          return [...html.matchAll(/<(script|link|img|source|audio|video)\b([^>]*)>/gi)]
            .map((match) => ({ getAttribute: attributes(match[2]) }))
            .filter((element) => element.getAttribute("src") !== null || element.getAttribute("href") !== null);
        },
      };
    }
  }
  beforeAll(() => vi.stubGlobal("DOMParser", FakeDOMParser));
  afterAll(() => vi.unstubAllGlobals());

  function htmlFs(files: Array<{ path: string; content: string }>): FileSystemManager {
    return {
      listEntries: async () => files,
      getFile: async (path: string) => files.find((file) => file.path === path),
    } as unknown as FileSystemManager;
  }
  const ids = (checks: Array<{ id: string; status: string }>) => checks.map((item) => `${item.id}:${item.status}`);

  it("accepts virtual .lib references that exist in no file", async () => {
    const checks = await verifyArtifacts(
      htmlFs([
        { path: "/pages/a.html", content: '<html><body><script src="../.lib/echarts.js"></script></body></html>' },
      ]),
      ["/pages/a.html"],
    );
    expect(ids(checks)).toContain("html.library:pass");
    expect(ids(checks)).not.toContain("html.local-ref:fail");
  });

  it("rejects unknown library names", async () => {
    const checks = await verifyArtifacts(
      htmlFs([{ path: "/a.html", content: '<script src=".lib/react.js"></script>' }]),
      ["/a.html"],
    );
    const failure = checks.find((item) => item.id === "html.library");
    expect(failure?.status).toBe("fail");
    expect(failure?.message).toContain(".lib/echarts.js");
  });

  it("reads changed files only and checks local dependencies against the index", async () => {
    const fs = htmlFs([
      { path: "/game.html", content: '<script src="game.js"></script><img src="missing.png">' },
      { path: "/game.js", content: "start()" },
      { path: "/unrelated.html", content: '<script src="missing.js"></script>' },
    ]);
    const read = vi.spyOn(fs, "getFile");
    const checks = await verifyArtifacts(fs, ["/game.html"]);
    expect(read.mock.calls).toEqual([["/game.html"]]);
    expect(checks).toContainEqual(expect.objectContaining({ id: "html.local-ref", status: "pass" }));
    expect(checks).toContainEqual(
      expect.objectContaining({
        id: "html.local-ref",
        status: "fail",
        message: "Missing local reference: missing.png (/missing.png)",
      }),
    );
    expect(checks.every((check) => check.scope === "/game.html")).toBe(true);
  });

  it("flags inline library source", async () => {
    const big = await verifyArtifacts(
      htmlFs([{ path: "/a.html", content: `<script>${"x".repeat(150_000)}</script>` }]),
      ["/a.html"],
    );
    expect(ids(big)).toContain("html.inline-library:fail");
    const banner = await verifyArtifacts(
      htmlFs([{ path: "/a.html", content: "<script>/*! Apache ECharts */var e=1</script>" }]),
      ["/a.html"],
    );
    expect(ids(banner)).toContain("html.inline-library:fail");
    const small = await verifyArtifacts(htmlFs([{ path: "/a.html", content: "<script>init()</script>" }]), ["/a.html"]);
    expect(ids(small)).not.toContain("html.inline-library:fail");
  });
});
