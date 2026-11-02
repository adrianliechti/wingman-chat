import fs from "node:fs";
import { transformSync } from "oxc-transform-react";
import { parseAst } from "vite";

// Compiler failures normally fall back to unoptimized code without failing a
// build. Guard the toolchain and the render paths we rely on being compiled.
function compile(filename, source) {
  const result = transformSync(filename, source, {
    sourceType: "module",
    reactCompiler: { target: "19", reportDiagnostics: true },
  });
  for (const error of result.errors) console.log(`${filename}: ${error.message}\n${error.codeframe ?? ""}`);
  if (result.fatal) throw new Error(`React Compiler failed to transform ${filename}`);
  return parseAst(result.code);
}

function isCompiled(program, name) {
  // The native compiler has no CompileSuccess logger. Check that this function
  // allocates a memo cache, not just that another function in the file compiled.
  const runtime = program.body.find(
    (node) => node.type === "ImportDeclaration" && node.source.value === "react/compiler-runtime",
  );
  const cache = runtime?.specifiers.find((node) => node.type === "ImportSpecifier" && node.imported.name === "c")?.local
    .name;
  const fn = program.body
    .map((node) => node.declaration ?? node)
    .find((node) => node.type === "FunctionDeclaration" && node.id?.name === name);
  if (!fn) throw new Error(`Missing compiler check target: ${name}`);
  return (
    !!cache &&
    fn.body.body.some(
      (node) =>
        node.type === "VariableDeclaration" &&
        node.declarations.some(
          ({ init }) =>
            init?.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === cache,
        ),
    )
  );
}

const smoke = compile(
  "compiler-smoke.tsx",
  `
  export function Card({ title = "Hello" }) { return <div>{title}</div>; }
  export function UncompiledCard({ title }) { "use no memo"; return <div>{title}</div>; }
`,
);
if (!isCompiled(smoke, "Card") || isCompiled(smoke, "UncompiledCard")) {
  throw new Error("React Compiler must memoize defaulted props and respect use no memo.");
}

const targets = [
  ["src/features/chat/pages/ChatPage.tsx", "ChatPage"],
  ["src/features/chat/components/ChatSidebar.tsx", "ChatSidebar"],
  ["src/features/chat/components/ChatSidebar.tsx", "VirtualChatList", false],
  ["src/features/chat/components/ChatMessageAttachments.tsx", "ChatMessageAttachments"],
  ["src/features/chat/components/PanelShell.tsx", "PanelShell"],
  ["src/shell/AppLayout.tsx", "AppLayout"],
];
let failed = false;
const programs = new Map();
for (const [filename, name, expected = true] of targets) {
  if (!programs.has(filename)) programs.set(filename, compile(filename, fs.readFileSync(filename, "utf8")));
  const compiled = isCompiled(programs.get(filename), name);
  console.log(`${compiled ? "Compiled" : expected ? "NOT COMPILED" : "Opted out"}: ${name}`);
  failed ||= compiled !== expected;
}
if (failed) process.exitCode = 1;
