import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function archive(entries: Record<string, string>): Promise<number[]> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(entries)) zip.file(name, contents);
  return Array.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

async function renderDocx(page: Page, bytes: number[]) {
  return page.evaluate(async (data: number[]) => {
    // @ts-expect-error The module is resolved by the browser's Vite dev server.
    const { docxToHtml } = await import("/src/shared/lib/docxToHtml.ts");
    const html = await docxToHtml(new File([new Uint8Array(data)], "breaks.docx"));
    const frame = document.createElement("iframe");
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rendered = frame.contentDocument;
    if (!rendered) throw new Error("DOCX iframe did not load");
    return Array.from(rendered.querySelectorAll<HTMLElement>("body > .pg")).map((item) => ({
      body: item.querySelector<HTMLElement>(".pg-body")?.innerText.trim() ?? "",
      header: item.querySelector<HTMLElement>(".hf-top")?.innerText.trim() ?? "",
      notes: item.querySelector<HTMLElement>(".pg-notes")?.innerText.trim() ?? "",
      parityBlank: item.dataset.parityBlank === "1",
      firstParagraphLineHeight: (() => {
        const paragraph = item.querySelector<HTMLElement>(".pg-body > .p");
        return paragraph ? Number.parseFloat(getComputedStyle(paragraph).lineHeight) : 0;
      })(),
    }));
  }, bytes);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/interpreter.html");
});

test("places authored breaks and footnotes on their physical pages", async ({ page }) => {
  const bytes = await archive({
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${officeRelationshipNamespace}"><w:body><w:p><w:r><w:t>Before authored break</w:t><w:br w:type="page"/><w:t>After authored break</w:t><w:footnoteReference w:id="1"/></w:r></w:p><w:p><w:r><w:t>Cached before</w:t><w:lastRenderedPageBreak/><w:t> cached after</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="h1" Type="${officeRelationshipNamespace}/header" Target="header1.xml"/></Relationships>`,
    "word/header1.xml": `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t> / </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`,
    "word/footnotes.xml": `<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:type="separator" w:id="0"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Page-local note</w:t></w:r></w:p></w:footnote></w:footnotes>`,
  });

  const pages = await renderDocx(page, bytes);

  expect(pages).toHaveLength(2);
  expect(pages[0].body).toContain("Before authored break");
  expect(pages[0].body).not.toContain("After authored break");
  expect(pages[1].body).toContain("After authored break");
  expect(pages[1].body).toContain("Cached before cached after");
  expect(pages.map(({ header }) => header)).toEqual(["Page 1 / 2", "Page 2 / 2"]);
  expect(pages[0].notes).toBe("");
  expect(pages[1].notes).toContain("Page-local note");
});

test("keeps continuous sections on-page and pads odd-page starts", async ({ page }) => {
  const bytes = await archive({
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${officeRelationshipNamespace}"><w:body><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:headerReference w:type="default" r:id="h0"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:pPr><w:r><w:t>Continuous section zero</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:type w:val="oddPage"/><w:headerReference w:type="default" r:id="h1"/></w:sectPr></w:pPr><w:r><w:t>Continuous section one</w:t></w:r></w:p><w:p><w:r><w:t>Odd-page section two</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h2"/></w:sectPr></w:body></w:document>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="h0" Type="${officeRelationshipNamespace}/header" Target="header0.xml"/><Relationship Id="h1" Type="${officeRelationshipNamespace}/header" Target="header1.xml"/><Relationship Id="h2" Type="${officeRelationshipNamespace}/header" Target="header2.xml"/></Relationships>`,
    "word/header0.xml": `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header Zero</w:t></w:r></w:p></w:hdr>`,
    "word/header1.xml": `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header One</w:t></w:r></w:p></w:hdr>`,
    "word/header2.xml": `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header Two</w:t></w:r></w:p></w:hdr>`,
  });

  const pages = await renderDocx(page, bytes);

  expect(pages).toHaveLength(3);
  expect(pages[0].body).toContain("Continuous section zero");
  expect(pages[0].body).toContain("Continuous section one");
  expect(pages[1].body).toBe("");
  expect(pages[1].parityBlank).toBe(true);
  expect(pages[2].body).toContain("Odd-page section two");
  expect(pages.map(({ header }) => header)).toEqual(["Header Zero", "Header One", "Header Two"]);
});

test("uses the section line grid for auto line spacing", async ({ page }) => {
  const bytes = await archive({
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:spacing w:line="1040" w:lineRule="auto"/><w:rPr><w:sz w:val="112"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="112"/></w:rPr><w:t>Large cover heading</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:body></w:document>`,
  });

  const pages = await renderDocx(page, bytes);

  expect(pages).toHaveLength(1);
  // 360 twips = 24 CSS px; auto spacing 1040/240 = 4⅓ grid lines.
  expect(pages[0].firstParagraphLineHeight).toBeCloseTo(104, 1);
});

test("keeps comments outside the page stack and opens the referenced comment", async ({ page }) => {
  const bytes = await archive({
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:commentRangeStart w:id="4"/><w:r><w:t>Reviewed text</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
    "word/comments.xml": `<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="4" w:author="Reviewer" w:date="2026-08-23T10:00:00Z"><w:p><w:r><w:t>Keep this concise.</w:t></w:r></w:p></w:comment></w:comments>`,
  });

  const state = await page.evaluate(async (data: number[]) => {
    // @ts-expect-error The module is resolved by the browser's Vite dev server.
    const { docxToHtml } = await import("/src/shared/lib/docxToHtml.ts");
    const html = await docxToHtml(new File([new Uint8Array(data)], "comments.docx"));
    const frame = document.createElement("iframe");
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rendered = frame.contentDocument;
    if (!rendered) throw new Error("DOCX iframe did not load");
    const panel = rendered.querySelector<HTMLElement>("#docx-comments");
    const toggle = rendered.querySelector<HTMLElement>(".comments-toggle");
    const marker = rendered.querySelector<HTMLElement>('a[href="#comment-1"]');
    if (!panel || !toggle || !marker) throw new Error("Comment controls were not rendered");
    const initiallyHidden = panel.hidden;
    marker.click();
    const opened = !panel.hidden;
    const activeText = panel.querySelector<HTMLElement>(".comment.is-active")?.innerText ?? "";
    panel.querySelector<HTMLButtonElement>("[data-comments-close]")?.click();
    return {
      pageCount: rendered.querySelectorAll("body > .pg").length,
      toggleText: toggle.innerText,
      initiallyHidden,
      opened,
      activeText,
      closed: panel.hidden,
    };
  }, bytes);

  expect(state).toEqual({
    pageCount: 1,
    toggleText: "Comments 1",
    initiallyHidden: true,
    opened: true,
    activeText: "1\nReviewer · 2026-08-23\nKeep this concise.",
    closed: true,
  });
});
