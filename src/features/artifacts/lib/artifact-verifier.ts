import JSZip from "jszip";
import { getDocument } from "pdfjs-dist";
import type { FileSystemManager } from "./fs";
import { ARTIFACT_LIBRARIES, findArtifactLibrary, libraryNameFromPath } from "@/shared/lib/artifactLibraries";
import { contentToBlob, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isBinaryContentType } from "@/shared/lib/fileTypes";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { pdfAssetOptions } from "@/shared/lib/pdf";
import { ooxmlDescendants, SPREADSHEETML_NAMESPACES } from "@/shared/lib/ooxml";
import { validateArtifactFile } from "./artifactValidators";
import { validateOoxmlPackage, type OoxmlIssue } from "./ooxmlPackage";
import { validateXlsxIntegrity } from "./xlsxIntegrity";
interface ArtifactVerificationCheck {
  id: string;
  scope: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

type Check = ArtifactVerificationCheck;

function check(id: string, scope: string, status: Check["status"], message: string): Check {
  return { id, scope, status, message };
}

const REPORTED_ISSUE_LIMIT = 12;

/** An inline script this large is almost always an embedded library or dataset. */
const INLINE_SCRIPT_LIMIT = 100_000;
const LIBRARY_BANNER = /Apache ECharts|three\.js|three\.module|@license lucide|lucide v\d/i;

async function integrityChecks(
  path: string,
  passId: string,
  passMessage: string,
  validate: () => Promise<OoxmlIssue[]>,
): Promise<Check[]> {
  let issues: OoxmlIssue[];
  try {
    issues = await validate();
  } catch (error) {
    return [
      check(passId, path, "fail", `Validation failed: ${error instanceof Error ? error.message : String(error)}`),
    ];
  }
  if (issues.length === 0) return [check(passId, path, "pass", passMessage)];
  const reported = issues
    .slice(0, REPORTED_ISSUE_LIMIT)
    .map((issue) => check(issue.id, path, issue.severity, issue.message));
  if (issues.length > REPORTED_ISSUE_LIMIT) {
    reported.push(check(passId, path, "warn", `${issues.length - REPORTED_ISSUE_LIMIT} further issue(s) not listed.`));
  }
  return reported;
}

function relativeArtifactPath(basePath: string, reference: string): string | null {
  if (!reference || reference.startsWith("#") || reference.startsWith("data:") || reference.startsWith("blob:")) {
    return null;
  }
  if (/^https?:\/\//i.test(reference)) return reference;
  const clean = reference.split(/[?#]/, 1)[0];
  const base = basePath.slice(0, basePath.lastIndexOf("/") + 1);
  const segments = (clean.startsWith("/") ? clean : `${base}${clean}`).split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return normalizeArtifactPath(`/${resolved.join("/")}`) ?? null;
}

function verifyHtml(path: string, content: string, existingPaths: Set<string>, checks: Check[]): void {
  // text/html parsing always yields a root element, so there is no failing variant.
  const document = new DOMParser().parseFromString(content, "text/html");
  checks.push(check("html.root", path, "pass", "HTML document has a root element."));

  const resources = [
    ...document.querySelectorAll("script[src], link[href], img[src], source[src], audio[src], video[src]"),
  ];
  for (const element of resources) {
    const reference = element.getAttribute("src") ?? element.getAttribute("href") ?? "";
    const resolved = relativeArtifactPath(path, reference);
    if (!resolved) continue;
    if (/^https?:\/\//i.test(resolved)) {
      checks.push(check("html.no-cdn", path, "fail", `External runtime dependency is not allowed: ${reference}`));
      continue;
    }
    // `.lib/<name>` is the virtual library folder: served by the preview, inlined on export.
    const library = libraryNameFromPath(resolved);
    if (library) {
      checks.push(
        findArtifactLibrary(library)
          ? check("html.library", path, "pass", `Bundled library reference: ${reference}`)
          : check(
              "html.library",
              path,
              "fail",
              `Unknown bundled library ${reference}; available: ${ARTIFACT_LIBRARIES.map((item) => `.lib/${item.name}`).join(", ")}`,
            ),
      );
      continue;
    }
    if (!existingPaths.has(resolved)) {
      checks.push(check("html.local-ref", path, "fail", `Missing local reference: ${reference} (${resolved})`));
    } else {
      checks.push(check("html.local-ref", path, "pass", `Resolved local reference: ${reference}`));
    }
  }

  // Library (or dataset) source pasted into the page costs tokens on every
  // read and edit; libraries belong in `.lib/` references, data in files.
  for (const script of document.querySelectorAll("script:not([src])")) {
    const text = script.textContent ?? "";
    const banner = LIBRARY_BANNER.exec(text.slice(0, 4000));
    if (text.length <= INLINE_SCRIPT_LIMIT && !banner) continue;
    checks.push(
      check(
        "html.inline-library",
        path,
        "fail",
        `Inline script of ${Math.round(text.length / 1024)} KB${banner ? ` (${banner[0]})` : ""} embeds library or data source. Reference bundled libraries as .lib/echarts.js, .lib/three.js or .lib/lucide.js and keep data in workspace files instead.`,
      ),
    );
  }
}

async function verifyBinaryPackage(path: string, content: string, checks: Check[]): Promise<void> {
  const lower = path.toLowerCase();
  const bytes = dataUrlToBytes(content)?.bytes;
  if (!bytes) {
    checks.push(check("binary.encoding", path, "fail", "Binary artifact is not stored as a valid data URL."));
    return;
  }

  if (lower.endsWith(".pdf")) {
    try {
      const loadingTask = getDocument({ data: bytes, useSystemFonts: true, ...pdfAssetOptions });
      const pdf = await loadingTask.promise;
      checks.push(
        check("pdf.pages", path, pdf.numPages > 0 ? "pass" : "fail", `PDF contains ${pdf.numPages} page(s).`),
      );
      await loadingTask.destroy();
    } catch (error) {
      checks.push(
        check(
          "pdf.parse",
          path,
          "fail",
          `PDF could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    return;
  }

  if (lower.endsWith(".docx") || lower.endsWith(".pptx") || lower.endsWith(".xlsx")) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const format = lower.endsWith(".docx") ? "docx" : lower.endsWith(".pptx") ? "pptx" : "xlsx";
      const packageValidation = await validateOoxmlPackage(zip, format);
      checks.push(
        ...(await integrityChecks(
          path,
          "ooxml.package",
          "OOXML package structure and relationships are consistent.",
          async () => packageValidation.issues,
        )),
      );
      if (lower.endsWith(".docx")) {
        const xml = packageValidation.mainPart
          ? await packageValidation.reader.text(packageValidation.mainPart)
          : undefined;
        checks.push(
          check(
            "docx.package",
            path,
            xml?.trim() ? "pass" : "fail",
            xml?.trim()
              ? "DOCX package contains document content."
              : "DOCX package is missing a non-empty main document part.",
          ),
        );
      } else if (lower.endsWith(".pptx")) {
        const slides = packageValidation.logicalUnits;
        const missingSlides = slides.filter((slide) => !slide.present).length;
        checks.push(
          check(
            "pptx.slides",
            path,
            slides.length > 0 && missingSlides === 0 ? "pass" : "fail",
            `PPTX declares ${slides.length} logical slide(s)${missingSlides ? `; ${missingSlides} are missing` : ""}.`,
          ),
        );
      } else {
        const workbook = packageValidation.mainPart
          ? await packageValidation.reader.text(packageValidation.mainPart)
          : undefined;
        const sheets = packageValidation.logicalUnits;
        const missingSheets = sheets.filter((sheet) => !sheet.present).length;
        checks.push(
          check(
            "xlsx.package",
            path,
            workbook?.trim() && sheets.length > 0 && missingSheets === 0 ? "pass" : "fail",
            `XLSX declares ${sheets.length} logical sheet(s)${missingSheets ? `; ${missingSheets} are missing` : ""}.`,
          ),
        );
        const formulaCount = (
          await Promise.all(
            packageValidation.worksheetParts.map(async (sheetPath) => {
              const root = await packageValidation.reader.xml(sheetPath);
              return [...ooxmlDescendants(root, "f", SPREADSHEETML_NAMESPACES)].length;
            }),
          )
        ).reduce((total, count) => total + count, 0);
        checks.push(
          check(
            "xlsx.formulas",
            path,
            "warn",
            `Found ${formulaCount} stored formula(s); browser verification does not recalculate workbooks.`,
          ),
        );
        checks.push(
          ...(await integrityChecks(path, "xlsx.tables", "Worksheet structures are consistent.", () =>
            validateXlsxIntegrity(packageValidation),
          )),
        );
      }
    } catch (error) {
      checks.push(
        check(
          "ooxml.parse",
          path,
          "fail",
          `OOXML package could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
}

/** Read only changed files; the workspace index is enough to check HTML dependencies. */
export async function verifyArtifacts(
  fs: Pick<FileSystemManager, "listEntries" | "getFile">,
  paths: Iterable<string>,
  signal?: AbortSignal,
): Promise<ArtifactVerificationCheck[]> {
  signal?.throwIfAborted();
  const existingPaths = new Set((await fs.listEntries()).map((file) => file.path));
  const checks: Check[] = [];
  for (const path of paths) {
    signal?.throwIfAborted();
    try {
      const file = await fs.getFile(path);
      if (!file) {
        checks.push(check("artifact.exists", path, "fail", "The artifact does not exist."));
        continue;
      }
      const validation = await validateArtifactFile(file);
      checks.push(
        ...validation.errors.map((issue) => check(`syntax.${issue.validator}`, path, "fail", issue.message)),
        ...validation.warnings.map((issue) => check(`syntax.${issue.validator}`, path, "warn", issue.message)),
      );
      if (/\.html?$/i.test(path)) verifyHtml(path, file.content, existingPaths, checks);
      if (isBinaryContentType(file.contentType ?? inferContentTypeFromPath(path))) {
        await verifyBinaryPackage(path, file.content, checks);
      }
      if (/\.(png|jpe?g|webp|gif)$/i.test(path)) {
        const bitmap = await createImageBitmap(contentToBlob(file.content, file.contentType));
        checks.push(
          check(
            "image.decode",
            path,
            bitmap.width > 0 && bitmap.height > 0 ? "pass" : "fail",
            `Image decodes at ${bitmap.width}×${bitmap.height}.`,
          ),
        );
        bitmap.close();
      }
    } catch (error) {
      signal?.throwIfAborted();
      checks.push(
        check(
          "artifact.verify",
          path,
          "fail",
          `Verification could not complete: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
  signal?.throwIfAborted();
  return checks;
}
