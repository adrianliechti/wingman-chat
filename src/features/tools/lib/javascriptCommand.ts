import { createInterpreterCommand } from "./interpreterCommand";
import { executeJavaScript } from "./javascript";

// `node --version` reports a Node-like label even though the sandbox is the
// browser engine, so scripts that probe the runtime don't bail out.
export const javascriptCommands = createInterpreterCommand({
  names: ["node", "js"],
  versionFlags: ["--version", "-v"],
  versionOutput: "v22 (sandboxed Web Worker)",
  codeFlags: ["-e", "--eval"],
  notFound: (arg) => `node: cannot find module '${arg}'\n`,
  noCode: "node: no code provided (use -e, a script file, or pipe via stdin)\n",
  execute: executeJavaScript,
});
