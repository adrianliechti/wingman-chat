import JSZip from "jszip";
import { describe, expect, it } from "vitest";
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
