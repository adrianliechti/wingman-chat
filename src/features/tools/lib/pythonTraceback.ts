/**
 * Trim a Pyodide traceback down to the frames the model can act on.
 *
 * The raw `PythonError.message` includes the frame of our own script entry
 * point, two `_pyodide` evaluator frames, and (for missing packages) advice to
 * install with micropip, which this sandbox does not support. Dropping those
 * leaves the user's frames, the library frames, and the exception line.
 */

const FRAME_LINE = /^ {2}File "(.+?)", line \d+/;
const CONTINUATION = /^ {4}/;
const HEADER = "Traceback (most recent call last):";
const MICROPIP_ADVICE_START = /^The module '.*' is included in the Pyodide distribution, but it is not installed\.$/;
const MICROPIP_ADVICE_END = /^See https:\/\/pyodide\.org\//;

/** Frames that belong to the runtime, never to the script being executed. */
export function isInternalPythonFrame(filename: string): boolean {
  return (
    filename.startsWith("<wingman") || filename.includes("/_pyodide/") || /\/python\d+\.zip\/pyodide\//.test(filename)
  );
}

export function formatPythonTraceback(message: string): string {
  const lines = message.split("\n");
  const kept: string[] = [];
  let skippingFrame = false;
  let skippingAdvice = false;

  for (const line of lines) {
    if (skippingAdvice) {
      if (MICROPIP_ADVICE_END.test(line)) skippingAdvice = false;
      continue;
    }
    if (MICROPIP_ADVICE_START.test(line)) {
      skippingAdvice = true;
      continue;
    }
    const frame = FRAME_LINE.exec(line);
    if (frame) {
      skippingFrame = isInternalPythonFrame(frame[1]);
      if (!skippingFrame) kept.push(line);
      continue;
    }
    if (skippingFrame && CONTINUATION.test(line)) continue;
    skippingFrame = false;
    kept.push(line);
  }

  // A header whose frames were all internal adds nothing.
  const result: string[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const line = kept[index];
    if (line === HEADER && !FRAME_LINE.test(kept[index + 1] ?? "")) continue;
    result.push(line);
  }
  return result.join("\n").trim();
}
