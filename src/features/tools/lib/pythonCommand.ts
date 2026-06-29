import { executeCode } from "./interpreter";
import { createInterpreterCommand } from "./interpreterCommand";

export const pythonCommands = createInterpreterCommand({
  names: ["python3", "python"],
  versionFlags: ["--version", "-V"],
  versionOutput: "Python 3.14 (Pyodide)",
  codeFlags: ["-c"],
  notFound: (arg) => `python3: can't open file '${arg}': [Errno 2] No such file or directory\n`,
  noCode: "python3: no code provided (use -c, a script file, or pipe via stdin)\n",
  execute: executeCode,
});
