import JSZip from "jszip";
import { getDocument } from "pdfjs-dist";
import type { FileSystemManager } from "./fs";
import { contentToBlob, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isBinaryContentType } from "@/shared/lib/fileTypes";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { pdfAssetOptions } from "@/shared/lib/pdf";
import { ooxmlDescendants, SPREADSHEETML_NAMESPACES } from "@/shared/lib/ooxml";
import { validateArtifactFile } from "./artifactValidators";
import { validateOoxmlPackage, type OoxmlIssue } from "./ooxmlPackage";
import { validateXlsxIntegrity } from "./xlsxIntegrity";
import {
  ArtifactManifestSchema,
  VerificationReportSchema,
  artifactChecksum,
  artifactRevision,
  type ArtifactJob,
  type ArtifactManifest,
  type ArtifactUnitResult,
  type VerificationReport,
} from "@/shared/types/artifact";

type Check = VerificationReport["checks"][number];

function check(id: string, scope: string, status: Check["status"], message: string): Check {
  return { id, scope, status, message };
}

const REPORTED_ISSUE_LIMIT = 12;

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

async function verifyHtml(
  path: string,
  content: string,
  existingPaths: Set<string>,
  checks: Check[],
): Promise<Set<string>> {
  const dependencies = new Set<string>();
  const document = new DOMParser().parseFromString(content, "text/html");
  checks.push(
    document.documentElement
      ? check("html.root", path, "pass", "HTML document has a root element.")
      : check("html.root", path, "fail", "HTML document has no root element."),
  );

  const resources = [
    ...document.querySelectorAll("script[src], link[href], img[src], source[src], audio[src], video[src]"),
  ];
  for (const element of resources) {
    const reference = element.getAttribute("src") ?? element.getAttribute("href") ?? "";
    const resolved = relativeArtifactPath(path, reference);
    if (!resolved) continue;
    if (/^https?:\/\//i.test(resolved)) {
      checks.push(check("html.no-cdn", path, "fail", `External runtime dependency is not allowed: ${reference}`));
    } else if (!existingPaths.has(resolved)) {
      checks.push(check("html.local-ref", path, "fail", `Missing local reference: ${reference} (${resolved})`));
    } else {
      dependencies.add(resolved);
      checks.push(check("html.local-ref", path, "pass", `Resolved local reference: ${reference}`));
    }
  }
  return dependencies;
}

async function verifyBinaryPackage(
  job: ArtifactJob,
  path: string,
  content: string,
  checks: Check[],
): Promise<ArtifactUnitResult[] | undefined> {
  const lower = path.toLowerCase();
  const bytes = dataUrlToBytes(content)?.bytes;
  if (!bytes) {
    checks.push(check("binary.encoding", path, "fail", "Binary artifact is not stored as a valid data URL."));
    return undefined;
  }

  if (lower.endsWith(".pdf")) {
    try {
      const loadingTask = getDocument({ data: bytes, useSystemFonts: true, ...pdfAssetOptions });
      const pdf = await loadingTask.promise;
      checks.push(
        check("pdf.pages", path, pdf.numPages > 0 ? "pass" : "fail", `PDF contains ${pdf.numPages} page(s).`),
      );
      if (job.expected?.units && pdf.numPages !== job.expected.units) {
        checks.push(
          check("pdf.expected-pages", path, "fail", `Expected ${job.expected.units} pages, found ${pdf.numPages}.`),
        );
      }
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
    return undefined;
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
        if (job.expected?.units && slides.length !== job.expected.units) {
          checks.push(
            check(
              "pptx.expected-slides",
              path,
              "fail",
              `Expected ${job.expected.units} slides, found ${slides.length}.`,
            ),
          );
        }
        if (job.expected?.units) {
          return Array.from({ length: job.expected.units }, (_, index) => ({
            ordinal: index + 1,
            ...(slides[index]?.path ? { path: slides[index].path } : {}),
            status: slides[index]?.present ? ("ready" as const) : ("missing" as const),
            ...(slides[index]?.present ? {} : { message: `Slide ${index + 1} is missing.` }),
          }));
        }
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
  return undefined;
}

export async function verifyArtifactJob(fs: FileSystemManager, job: ArtifactJob): Promise<ArtifactManifest> {
  const files = await fs.listFiles();
  const existingPaths = new Set(files.map((file) => file.path));
  const checks: Check[] = [];
  const primary = files.find((file) => file.path === normalizeArtifactPath(job.primaryPath));
  const manifestPaths = new Set(
    job.sourceRefs.flatMap((source) => {
      if (/^https?:\/\//i.test(source)) return [];
      const path = normalizeArtifactPath(source);
      return path ? [path] : [];
    }),
  );
  let units: ArtifactUnitResult[] | undefined;

  if (!primary) {
    checks.push(check("manifest.primary", job.primaryPath, "fail", "The declared primary artifact does not exist."));
  } else {
    manifestPaths.add(primary.path);
    checks.push(check("manifest.primary", primary.path, "pass", "The declared primary artifact exists."));
    const validation = await validateArtifactFile(primary);
    checks.push(
      ...validation.errors.map((issue) => check(`syntax.${issue.validator}`, primary.path, "fail", issue.message)),
    );
    checks.push(
      ...validation.warnings.map((issue) => check(`syntax.${issue.validator}`, primary.path, "warn", issue.message)),
    );

    if (/\.html?$/i.test(primary.path)) {
      const dependencies = await verifyHtml(primary.path, primary.content, existingPaths, checks);
      for (const path of dependencies) manifestPaths.add(path);
    }
    const primaryContentType = primary.contentType ?? inferContentTypeFromPath(primary.path);
    if (isBinaryContentType(primaryContentType)) {
      units = await verifyBinaryPackage(job, primary.path, primary.content, checks);
    }

    if (/\.(png|jpe?g|webp|gif)$/i.test(primary.path)) {
      try {
        const bitmap = await createImageBitmap(contentToBlob(primary.content, primary.contentType));
        checks.push(
          check(
            "image.decode",
            primary.path,
            bitmap.width > 0 && bitmap.height > 0 ? "pass" : "fail",
            `Image decodes at ${bitmap.width}×${bitmap.height}.`,
          ),
        );
        if (job.expected?.width && bitmap.width !== job.expected.width)
          checks.push(
            check("image.width", primary.path, "fail", `Expected width ${job.expected.width}, found ${bitmap.width}.`),
          );
        if (job.expected?.height && bitmap.height !== job.expected.height)
          checks.push(
            check(
              "image.height",
              primary.path,
              "fail",
              `Expected height ${job.expected.height}, found ${bitmap.height}.`,
            ),
          );
        bitmap.close();
      } catch (error) {
        checks.push(
          check(
            "image.decode",
            primary.path,
            "fail",
            `Image could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  for (const source of job.sourceRefs) {
    if (/^https?:\/\//i.test(source)) {
      checks.push(check("sources.recorded", job.primaryPath, "pass", `Recorded source URL: ${source}`));
      continue;
    }
    const sourcePath = normalizeArtifactPath(source);
    checks.push(
      sourcePath && existingPaths.has(sourcePath)
        ? check("sources.present", job.primaryPath, "pass", `Resolved source artifact: ${sourcePath}`)
        : check("sources.present", job.primaryPath, "fail", `Missing source artifact: ${source}`),
    );
  }

  const status = checks.some((item) => item.status === "fail")
    ? "blocked"
    : checks.some((item) => item.status === "warn")
      ? "warnings"
      : "clean";
  const verification = VerificationReportSchema.parse({ status, checks, verifiedAt: new Date().toISOString() });
  const manifestFiles = await Promise.all(
    files
      .filter((file) => manifestPaths.has(file.path))
      .map(async (file) => {
        const checksum = await artifactChecksum(file.content, file.contentType);
        return {
          path: file.path,
          role:
            file.path === primary?.path
              ? ("primary" as const)
              : job.sourceRefs.includes(file.path)
                ? ("source" as const)
                : ("asset" as const),
          contentType: file.contentType,
          size: new TextEncoder().encode(file.content).byteLength,
          revision: await artifactRevision(file.content, file.contentType),
          checksum,
        };
      }),
  );

  return ArtifactManifestSchema.parse({
    jobId: job.id,
    primaryPath: normalizeArtifactPath(job.primaryPath) ?? job.primaryPath,
    files: manifestFiles,
    units,
    sources: job.sourceRefs.map((source, index) => ({
      id: `source-${index + 1}`,
      ...(source.startsWith("http") ? { url: source } : { path: source }),
    })),
    skillRefs: job.skillRefs,
    promptLayerIds: ["chat.base", "studio.policy"],
    verification,
  });
}
