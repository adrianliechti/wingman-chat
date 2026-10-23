import { describe, expect, it } from "vitest";
import { formatPythonTraceback } from "./pythonTraceback";

const RAW_INDEX_ERROR = `Traceback (most recent call last):
  File "<wingman-scripts>", line 116, in _wingman_run_script
  File "/lib/python314.zip/_pyodide/_base.py", line 619, in eval_code_async
    await CodeRunner(
    ...<10 lines>...
    .run_async(globals, locals)
  File "/lib/python314.zip/_pyodide/_base.py", line 420, in run_async
    coroutine = eval(self.code, globals, locals)
  File "<exec>", line 3, in <module>
    y = x[5]
IndexError: list index out of range`;

describe("formatPythonTraceback", () => {
  it("drops runtime frames and keeps the script frame with its source line", () => {
    expect(formatPythonTraceback(RAW_INDEX_ERROR)).toBe(
      `Traceback (most recent call last):
  File "<exec>", line 3, in <module>
    y = x[5]
IndexError: list index out of range`,
    );
  });

  it("keeps nested script and library frames", () => {
    const raw = `Traceback (most recent call last):
  File "<wingman-scripts>", line 116, in _wingman_run_script
  File "/lib/python314.zip/_pyodide/_base.py", line 420, in run_async
    coroutine = eval(self.code, globals, locals)
  File "/home/user/analysis.py", line 7, in <module>
    main()
  File "/home/user/analysis.py", line 4, in main
    return frame["missing"]
  File "/lib/python3.14/site-packages/pandas/core/frame.py", line 4100, in __getitem__
    indexer = self.columns.get_loc(key)
KeyError: 'missing'`;
    expect(formatPythonTraceback(raw)).toBe(
      `Traceback (most recent call last):
  File "/home/user/analysis.py", line 7, in <module>
    main()
  File "/home/user/analysis.py", line 4, in main
    return frame["missing"]
  File "/lib/python3.14/site-packages/pandas/core/frame.py", line 4100, in __getitem__
    indexer = self.columns.get_loc(key)
KeyError: 'missing'`,
    );
  });

  it("removes the traceback header when only runtime frames remain", () => {
    const raw = `Traceback (most recent call last):
  File "<wingman-scripts>", line 119, in _wingman_run_script
RuntimeError: Script exited with status 3`;
    expect(formatPythonTraceback(raw)).toBe("RuntimeError: Script exited with status 3");
  });

  it("drops micropip install advice for missing modules", () => {
    const raw = `Traceback (most recent call last):
  File "<exec>", line 1, in <module>
ModuleNotFoundError: No module named 'polars'
The module 'polars' is included in the Pyodide distribution, but it is not installed.
You can install it by calling:
  await micropip.install("polars") in Python, or
  await pyodide.loadPackage("polars") in JavaScript
See https://pyodide.org/en/stable/usage/loading-packages.html for more details.`;
    expect(formatPythonTraceback(raw)).toBe(
      `Traceback (most recent call last):
  File "<exec>", line 1, in <module>
ModuleNotFoundError: No module named 'polars'`,
    );
  });

  it("keeps syntax error context from the compiler frames", () => {
    const raw = `Traceback (most recent call last):
  File "<wingman-scripts>", line 116, in _wingman_run_script
  File "/lib/python314.zip/_pyodide/_base.py", line 619, in eval_code_async
    await CodeRunner(
          ~~~~~~~~~~^
    )
    ^
  File "/lib/python314.zip/_pyodide/_base.py", line 151, in _parse_and_compile_gen
    mod = compile(source, filename, mode, flags | ast.PyCF_ONLY_AST)
  File "<exec>", line 1
    x = (
        ^
SyntaxError: '(' was never closed`;
    expect(formatPythonTraceback(raw)).toBe(
      `Traceback (most recent call last):
  File "<exec>", line 1
    x = (
        ^
SyntaxError: '(' was never closed`,
    );
  });

  it("handles chained exceptions", () => {
    const raw = `Traceback (most recent call last):
  File "<exec>", line 2, in <module>
    int("x")
ValueError: invalid literal for int() with base 10: 'x'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "<wingman-scripts>", line 116, in _wingman_run_script
  File "/lib/python314.zip/_pyodide/_base.py", line 420, in run_async
    coroutine = eval(self.code, globals, locals)
  File "<exec>", line 4, in <module>
    raise RuntimeError("bad input")
RuntimeError: bad input`;
    expect(formatPythonTraceback(raw)).toBe(
      `Traceback (most recent call last):
  File "<exec>", line 2, in <module>
    int("x")
ValueError: invalid literal for int() with base 10: 'x'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "<exec>", line 4, in <module>
    raise RuntimeError("bad input")
RuntimeError: bad input`,
    );
  });

  it("returns plain messages unchanged", () => {
    expect(formatPythonTraceback("Execution cancelled")).toBe("Execution cancelled");
  });
});
