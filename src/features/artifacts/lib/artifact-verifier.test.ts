import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ArtifactJobSchema } from "@/shared/types/artifact";
import type { FileSystemManager } from "./fs";
import { verifyArtifactJob } from "./artifact-verifier";

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
  it("reports authored PPTX slide order and paths from relationships", async () => {
    const path = "/deck.pptx";
    const file = {
      path,
      content: await pptxDataUrl(),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const fs = { listFiles: async () => [file] } as unknown as FileSystemManager;
    const now = new Date().toISOString();
    const job = ArtifactJobSchema.parse({
      id: "verify-pptx",
      chatId: "chat",
      kind: "slides",
      primaryPath: path,
      expected: { units: 2 },
      phase: "validating",
      sourceRefs: [],
      skillRefs: [],
      createdAt: now,
      updatedAt: now,
    });

    const manifest = await verifyArtifactJob(fs, job);

    expect(manifest.verification.status).toBe("clean");
    expect(manifest.verification.checks).toContainEqual(
      expect.objectContaining({ id: "ooxml.package", status: "pass" }),
    );
    expect(manifest.units).toEqual([
      { ordinal: 1, path: "ppt/slides/cover.xml", status: "ready" },
      { ordinal: 2, path: "ppt/slides/closing.xml", status: "ready" },
    ]);
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

  function htmlJob(primaryPath: string) {
    const now = new Date().toISOString();
    return ArtifactJobSchema.parse({
      id: "job",
      chatId: "chat",
      kind: "html",
      primaryPath,
      phase: "building",
      createdAt: now,
      updatedAt: now,
    });
  }
  function htmlFs(files: Array<{ path: string; content: string }>): FileSystemManager {
    return {
      listFiles: async () => files.map((file) => ({ ...file, contentType: "text/html" })),
    } as unknown as FileSystemManager;
  }
  const ids = (checks: Array<{ id: string; status: string }>) =>
    checks.map((item) => `${item.id}:${item.status}`);

  it("accepts virtual .lib references that exist in no file", async () => {
    const manifest = await verifyArtifactJob(
      htmlFs([{ path: "/pages/a.html", content: '<html><body><script src="../.lib/echarts.js"></script></body></html>' }]),
      htmlJob("/pages/a.html"),
    );
    expect(ids(manifest.verification.checks)).toContain("html.library:pass");
    expect(ids(manifest.verification.checks)).not.toContain("html.local-ref:fail");
    expect(manifest.files.map((file) => file.path)).toEqual(["/pages/a.html"]);
  });

  it("rejects unknown library names", async () => {
    const manifest = await verifyArtifactJob(
      htmlFs([{ path: "/a.html", content: '<script src=".lib/react.js"></script>' }]),
      htmlJob("/a.html"),
    );
    const failure = manifest.verification.checks.find((item) => item.id === "html.library");
    expect(failure?.status).toBe("fail");
    expect(failure?.message).toContain(".lib/echarts.js");
  });

  it("flags inline library source", async () => {
    const big = await verifyArtifactJob(
      htmlFs([{ path: "/a.html", content: `<script>${"x".repeat(150_000)}</script>` }]),
      htmlJob("/a.html"),
    );
    expect(ids(big.verification.checks)).toContain("html.inline-library:fail");
    const banner = await verifyArtifactJob(
      htmlFs([{ path: "/a.html", content: "<script>/*! Apache ECharts */var e=1</script>" }]),
      htmlJob("/a.html"),
    );
    expect(ids(banner.verification.checks)).toContain("html.inline-library:fail");
    const small = await verifyArtifactJob(
      htmlFs([{ path: "/a.html", content: "<script>init()</script>" }]),
      htmlJob("/a.html"),
    );
    expect(ids(small.verification.checks)).not.toContain("html.inline-library:fail");
  });
});
