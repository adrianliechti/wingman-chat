import { createRoot } from "react-dom/client";
import { AgentProvider } from "../../../src/features/agent/context/AgentProvider";
import { useAgents } from "../../../src/features/agent/hooks/useAgents";
import { MemorySection } from "../../../src/features/agent/components/MemorySection";
import { storeAgent } from "../../../src/features/agent/lib/agentStorage";
import { MemoryManager } from "../../../src/features/agent/lib/memoryManager";
import { mountMemoryFiles } from "../../../src/features/agent/lib/memoryFileMount";
import { subscribeMemory } from "../../../src/features/agent/lib/memoryEvents";
import { memoryRevision } from "../../../src/features/agent/lib/memoryDocument";
import { readText } from "../../../src/shared/lib/opfs-core";
import { flushPersistence } from "../../../src/shared/lib/persistence";
import { loadConfig } from "../../../src/shared/config";
import { ConfirmHost } from "../../../src/shell/components/ConfirmHost";
import "../../../src/index.css";

await loadConfig();
if (!(await readText("agents/memory-e2e/AGENTS.md")))
  await storeAgent({
    id: "memory-e2e",
    name: "Memory agent",
    model: "memory-test",
    memory: true,
    skills: [],
    plugins: [],
    tools: [],
    servers: [],
  });
localStorage.setItem("app_agent", "memory-e2e");
const manager = new MemoryManager("memory-e2e");
const tools = mountMemoryFiles([], manager);
let updates = 0;
let releaseSave: (() => void) | undefined;
let saveHeld = false;
function holdAgentSave() {
  const original = Object.getOwnPropertyDescriptor(FileSystemFileHandle.prototype, "createWritable")!
    .value as FileSystemFileHandle["createWritable"];
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const path = await (await navigator.storage.getDirectory()).resolve(this);
    if (path?.join("/") !== "agents/memory-e2e/AGENTS.md") return original.call(this, options);
    FileSystemFileHandle.prototype.createWritable = original;
    const stream = await original.call(this, options);
    const write = stream.write.bind(stream);
    stream.write = async (value) => {
      saveHeld = true;
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      return write(value);
    };
    return stream;
  };
}
subscribeMemory(manager.agentId, () => {
  updates++;
});
const api = {
  holdAgentSave,
  saveHeld: () => saveHeld,
  releaseAgentSave: () => {
    releaseSave?.();
    saveHeld = false;
  },
  call: async (name: string, args: Record<string, unknown>) =>
    tools
      .find((tool) => tool.name === `artifacts_${name}`)!
      .function(args, { chatId: "memory-chat", runId: "memory-run" }),
  files: async () => Object.fromEntries((await manager.snapshot()).files),
  index: () => readText("agents/memory-e2e/memory/index.md"),
  externalWrite: async (path: string, text: string) => {
    const before = (await manager.snapshot()).files.get(path);
    await manager.write(`/.memory/${path}`, text, before ? await memoryRevision(before) : undefined);
  },
  updates: () => updates,
  flush: flushPersistence,
  settings: () => manager.settings(),
};
declare global {
  interface Window {
    memoryE2E: typeof api;
  }
}
window.memoryE2E = api;
function Fixture() {
  const { currentAgent } = useAgents();
  return (
    <main className="mx-auto max-w-2xl p-8">
      {currentAgent && <MemorySection key={currentAgent.id} agent={currentAgent} />}
      <ConfirmHost />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <AgentProvider>
    <Fixture />
  </AgentProvider>,
);
