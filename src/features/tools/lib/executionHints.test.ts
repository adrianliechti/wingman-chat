import { describe, expect, it } from "vitest";
import { executionHints, suggestWorkspaceFiles, withExecutionHints } from "./executionHints";

const files = ["/data/sales_2024.csv", "/data/sales_2023.csv", "/notes.md", "/skills/pdf/scripts/extract.py"];

describe("executionHints", () => {
  it("explains missing Python packages and names a bundled replacement", () => {
    const hints = executionHints("ModuleNotFoundError: No module named 'polars.io'", { language: "python", files });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('Module "polars.io" could not be imported');
    expect(hints[0]).toContain("pandas or duckdb");
  });

  it("falls back to generic guidance for unknown packages", () => {
    const [hint] = executionHints("ModuleNotFoundError: No module named 'somepkg'", { language: "python", files });
    expect(hint).toContain("bundled package listed in the code execution instructions");
    expect(hint).not.toContain("is not bundled");
  });

  it.each(["openpyxl", "tabulate", "xlrd", "bs4"])("suggests preloading the bundled %s dependency", (module) => {
    const [hint] = executionHints(`ModuleNotFoundError: No module named '${module}'`, { language: "python", files });
    expect(hint).toContain(`import ${module}`);
    expect(hint).toContain("preload");
    expect(hint).not.toContain("is not bundled");
  });

  it("keeps missing submodules distinct from their installed parent", () => {
    const [hint] = executionHints("ModuleNotFoundError: No module named 'pandas.tools'", {
      language: "python",
      files,
    });
    expect(hint).toContain('Module "pandas.tools"');
    expect(hint).toContain("check the full import path and any local modules");
    expect(hint).not.toContain("is not bundled");
  });

  it("suggests similar workspace files for a missing Python path", () => {
    const [hint] = executionHints("FileNotFoundError: [Errno 44] No such file or directory: '/home/user/sales.csv'", {
      language: "python",
      files,
    });
    expect(hint).toContain('No workspace file matches "/home/user/sales.csv"');
    expect(hint).toContain("/data/sales_2024.csv, /data/sales_2023.csv");
    expect(hint).not.toContain("mounted under");
  });

  it("reminds about the mount point for absolute paths outside the sandbox home", () => {
    const [hint] = executionHints("FileNotFoundError: [Errno 44] No such file or directory: '/data/x.csv'", {
      language: "python",
      files,
    });
    expect(hint).toContain("/home/user/data/x.csv");
  });

  it("lists workspace files when nothing is similar, and says when it is empty", () => {
    const [listed] = executionHints("FileNotFoundError: [Errno 44] No such file or directory: 'report.pdf'", {
      language: "python",
      files,
    });
    expect(listed).toContain("Workspace files: /data/sales_2024.csv");
    const [empty] = executionHints("FileNotFoundError: [Errno 44] No such file or directory: 'report.pdf'", {
      language: "python",
      files: [],
    });
    expect(empty).toContain("workspace has no files");
  });

  it("treats a missing host program as a subprocess problem, not a missing file", () => {
    const hints = executionHints("FileNotFoundError: [Errno 44] No such file or directory: 'ffmpeg'", {
      language: "python",
      files,
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("no host shell");
  });

  it("handles Bash and JavaScript missing-file wording", () => {
    const [bash] = executionHints("cat: sales.csv: No such file or directory", { language: "bash", files });
    expect(bash).toContain('"sales.csv"');
    const [js] = executionHints("Error: file not found: /sales.csv", { language: "javascript", files });
    expect(js).toContain('"/sales.csv"');
    expect(js).not.toContain("mounted under");
  });

  it.each(["found", "available in browser environments"])("maps Bash commands not %s to recovery hints", (reason) => {
    const [python] = executionHints(`bash: python3: command not ${reason}`, { language: "bash", files });
    expect(python).toContain("language python");
    const [node] = executionHints(`bash: node: command not ${reason}`, { language: "bash", files });
    expect(node).toContain("language javascript");
    expect(executionHints(`bash: node: command not ${reason}`, { language: "bash", files })).toHaveLength(1);
    const [other] = executionHints(`bash: foo: command not ${reason}`, { language: "bash", files });
    expect(other).toContain("virtual Unix commands");
  });

  it("explains JavaScript sandbox limits", () => {
    expect(executionHints("ReferenceError: document is not defined", { language: "javascript", files })[0]).toContain(
      "without a DOM",
    );
    expect(
      executionHints('Error: require("fs") is not available — the sandbox has no npm', {
        language: "javascript",
        files,
      })[0],
    ).toContain("No npm");
  });

  it("covers documented Python pitfalls", () => {
    expect(
      executionHints("RuntimeError: asyncio.run() cannot be called from a running event loop", {
        language: "python",
        files,
      })[0],
    ).toContain("top-level await");
    expect(
      executionHints("AttributeError: 'pyarrow.lib.RecordBatchReader' object has no attribute 'to_pandas'", {
        language: "python",
        files,
      })[0],
    ).toContain("to_arrow_table");
    expect(
      executionHints(
        "duckdb.duckdb.CatalogException: Catalog Error: Table Function with name read_xlsx does not exist!",
        {
          language: "python",
          files,
        },
      )[0],
    ).toContain("pandas.read_excel");
  });

  it("applies rules only to their language", () => {
    expect(executionHints("ReferenceError: document is not defined", { language: "python", files })).toEqual([]);
  });

  it("returns errors without hints unchanged", () => {
    expect(withExecutionHints("KeyError: 'x'", { language: "python", files })).toBe("KeyError: 'x'");
  });

  it("appends hints as a list", () => {
    expect(
      withExecutionHints("ModuleNotFoundError: No module named 'requests'", { language: "python", files }),
    ).toMatch(/^ModuleNotFoundError: No module named 'requests'\n\nHint:\n- Module "requests"/);
  });
});

describe("suggestWorkspaceFiles", () => {
  it("prefers exact basename matches", () => {
    expect(suggestWorkspaceFiles("/home/user/Notes.md", files)).toEqual(["/notes.md"]);
  });

  it("matches by stem in either direction", () => {
    expect(suggestWorkspaceFiles("sales.parquet", files)).toEqual(["/data/sales_2024.csv", "/data/sales_2023.csv"]);
    expect(suggestWorkspaceFiles("sales_2024_final.csv", files)).toEqual(["/data/sales_2024.csv"]);
  });

  it("ignores very short stems", () => {
    expect(suggestWorkspaceFiles("a.csv", files)).toEqual([]);
  });
});
