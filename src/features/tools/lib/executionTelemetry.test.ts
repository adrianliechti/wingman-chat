import { describe, expect, it } from "vitest";
import { executionErrorClass } from "./executionTelemetry";

describe("executionErrorClass", () => {
  it("takes the last exception type of a Python traceback", () => {
    const traceback = `Traceback (most recent call last):
  File "<exec>", line 2, in <module>
    int("x")
ValueError: invalid literal for int() with base 10: 'x'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "<exec>", line 4, in <module>
duckdb.duckdb.CatalogException: Catalog Error: Table Function with name read_xlsx does not exist!`;
    expect(executionErrorClass(traceback, "python")).toBe("CatalogException");
    expect(executionErrorClass("RuntimeError: Script exited with status 3", "python")).toBe("RuntimeError");
    expect(executionErrorClass("Execution cancelled", "python")).toBe("unknown");
  });

  it("uses the JavaScript error constructor", () => {
    expect(executionErrorClass("TypeError: vfs.read is not a function\n    at <anonymous>", "javascript")).toBe(
      "TypeError",
    );
    expect(executionErrorClass("something odd", "javascript")).toBe("unknown");
  });

  it("buckets Bash failures", () => {
    expect(executionErrorClass("bash: python3: command not found\nexit status 127", "bash")).toBe("command-not-found");
    expect(executionErrorClass("bash: python3: command not available in browser environments", "bash")).toBe(
      "command-not-found",
    );
    expect(executionErrorClass("cat: x.csv: No such file or directory\nexit status 1", "bash")).toBe("missing-file");
    expect(executionErrorClass("Command failed with exit status 2", "bash")).toBe("exit-2");
  });
});
