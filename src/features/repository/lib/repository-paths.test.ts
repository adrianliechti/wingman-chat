import { describe, expect, it } from "vitest";
import type { RepositoryFile } from "@/features/repository/types/repository";
import {
  allocateRepositoryFilePath,
  reconcileRepositoryFilePaths,
  sanitizeRepositoryFileName,
} from "./repository-paths";

function file(id: string, name: string, path?: string, uploadedAt = "2025-01-01T00:00:00.000Z"): RepositoryFile {
  return {
    id,
    name,
    path,
    status: "completed",
    progress: 100,
    text: name,
    uploadedAt: new Date(uploadedAt),
  };
}

describe("repository paths", () => {
  it("keeps long duplicate names stable through reloads and removal of their sibling", () => {
    const name = `${"a".repeat(180)}.pdf`;
    const first = file("aaaaaaaa", name);
    const second = file("bbbbbbbb", name);
    const migrated = reconcileRepositoryFilePaths([first, second]);
    for (const entry of migrated.files) expect(entry.path.length).toBeLessThanOrEqual(181);
    expect(reconcileRepositoryFilePaths(migrated.files).changedIds).toEqual([]);
    expect(reconcileRepositoryFilePaths([migrated.files[1]]).files[0].path).toBe(migrated.files[1].path);
  });
  it("sanitizes untrusted flat filenames while preserving useful extensions", () => {
    expect(sanitizeRepositoryFileName(" ../Quarter\\Report.pdf \u0000")).toBe("-Quarter-Report.pdf");
    expect(sanitizeRepositoryFileName("... ")).toBe("document");
    expect(sanitizeRepositoryFileName(`${"a".repeat(220)}.pdf`)).toHaveLength(180);
    expect(sanitizeRepositoryFileName(`${"a".repeat(220)}.pdf`)).toMatch(/\.pdf$/);
  });

  it("uses the readable filename until a case-insensitive collision occurs", () => {
    expect(allocateRepositoryFilePath("Report.pdf", "aaaaaaaa-0000", [])).toBe("/Report.pdf");
    expect(allocateRepositoryFilePath("report.pdf", "bbbbbbbb-0000", ["/Report.pdf"])).toBe("/report~bbbbbbbb.pdf");
  });

  it("backfills legacy files deterministically regardless of enumeration order", () => {
    const older = file("aaaaaaaa-0000", "report.pdf", undefined, "2024-01-01T00:00:00.000Z");
    const newer = file("bbbbbbbb-0000", "Report.pdf", undefined, "2025-01-01T00:00:00.000Z");

    const forward = reconcileRepositoryFilePaths([older, newer]);
    const reverse = reconcileRepositoryFilePaths([newer, older]);

    expect(Object.fromEntries(forward.files.map((entry) => [entry.id, entry.path]))).toEqual({
      "aaaaaaaa-0000": "/report.pdf",
      "bbbbbbbb-0000": "/Report~bbbbbbbb.pdf",
    });
    expect(Object.fromEntries(reverse.files.map((entry) => [entry.id, entry.path]))).toEqual(
      Object.fromEntries(forward.files.map((entry) => [entry.id, entry.path])),
    );
    expect(forward.changedIds).toEqual(["aaaaaaaa-0000", "bbbbbbbb-0000"]);
  });

  it("preserves valid allocations and repairs duplicate or unsafe legacy paths", () => {
    const result = reconcileRepositoryFilePaths([
      file("aaaaaaaa-0000", "first.pdf", "/kept.pdf"),
      file("bbbbbbbb-0000", "second.pdf", "/KEPT.pdf"),
      file("cccccccc-0000", "third.pdf", "../escape.pdf"),
    ]);

    expect(result.files.map((entry) => entry.path)).toEqual(["/kept.pdf", "/second.pdf", "/third.pdf"]);
    expect(result.changedIds).toEqual(["bbbbbbbb-0000", "cccccccc-0000"]);
  });
});
