import fs from "node:fs";
import { transformSync } from "@babel/core";
import compilerModule from "babel-plugin-react-compiler";

// Compiler failures normally fall back to unoptimized code without failing a
// build. Guard the toolchain and the render paths we rely on being compiled.
const compiler = compilerModule.default ?? compilerModule;
function compile(filename, source) {
  const events = [];
  transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [[compiler, { target: "19", logger: { logEvent: (_, event) => events.push(event) } }]],
  });
  return events;
}

const smoke = compile("compiler-smoke.tsx", 'function Card({ title = "Hello" }) { return <div>{title}</div>; }');
if (!smoke.some((event) => event.kind === "CompileSuccess")) {
  throw new Error("React Compiler cannot compile defaulted props. Check Babel/compiler compatibility.");
}

const targets = [
  ["src/features/chat/pages/ChatPage.tsx", "ChatPage"],
  ["src/features/chat/components/ChatSidebar.tsx", "ChatSidebar"],
  ["src/features/chat/components/ChatMessageAttachments.tsx", "ChatMessageAttachments"],
  ["src/features/chat/components/PanelShell.tsx", "PanelShell"],
  ["src/shell/AppLayout.tsx", "AppLayout"],
];
let failed = false;
for (const [filename, name] of targets) {
  const events = compile(filename, fs.readFileSync(filename, "utf8"));
  const compiled = events.some((event) => event.kind === "CompileSuccess" && event.fnName === name);
  console.log(`${compiled ? "Compiled" : "NOT COMPILED"}: ${name}`);
  failed ||= !compiled;
  const skips = new Set(
    events
      .filter((event) => event.kind === "CompileError" || event.kind === "CompileSkip")
      .map((event) => `${filename}:${event.fnLoc?.start.line ?? 1}: ${event.reason ?? event.detail.reason}`),
  );
  for (const skip of skips) console.log(`  Skipped: ${skip}`);
}
if (failed) process.exitCode = 1;
