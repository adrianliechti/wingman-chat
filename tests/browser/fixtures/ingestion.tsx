import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProvider } from "../../../src/features/agent/context/AgentProvider";
import { useAgents } from "../../../src/features/agent/hooks/useAgents";
import { useAgentFiles } from "../../../src/features/agent/hooks/useAgentFiles";
import { FilesSection } from "../../../src/features/agent/components/FilesSection";
import { getConfig, loadConfig } from "../../../src/shared/config";
import { flushPersistence } from "../../../src/shared/lib/persistence";
import * as opfs from "../../../src/shared/lib/opfs";

await loadConfig();
let ingestion = Promise.resolve();
let query = Promise.resolve<Awaited<ReturnType<ReturnType<typeof useAgentFiles>["queryChunks"]>>>([]);

function Fixture() {
  const agents = useAgents();
  const files = useAgentFiles(agents.currentAgent?.id ?? "");
  // Upload and deletion originate from separate consumers in the real app.
  const inspector = useAgentFiles(agents.currentAgent?.id ?? "");
  const [, refreshConfig] = useState(0);
  const api = {
    state: () => ({ agents: agents.agents, current: agents.currentAgent }),
    createAgent: agents.createAgent,
    deleteAgent: agents.deleteAgent,
    select: (id: string) => agents.setCurrentAgent(agents.agents.find((agent) => agent.id === id) ?? null),
    remove: inspector.removeFile,
    startAdd: (name = "notes.ingest", text = "Source") => {
      ingestion = files.addFile(
        new File([text], name, { type: name.endsWith(".ingest") ? "application/octet-stream" : "" }),
      );
      void ingestion.catch(() => {});
    },
    startTwo: () => {
      ingestion = Promise.all([
        files.addFile(new File(["One"], "notes.txt")),
        inspector.addFile(new File(["Two"], "notes.txt")),
      ]).then(() => {});
      void ingestion.catch(() => {});
    },
    startBatch: () => {
      ingestion = (async () => {
        for (const name of ["first.ingest", "second.ingest"]) {
          await files.addFile(new File(["Source"], name, { type: "application/octet-stream" }));
        }
      })();
      void ingestion.catch(() => {});
    },
    finish: () => ingestion,
    startQuery: (text: string) => {
      query = files.queryChunks(text);
      void query.catch(() => {});
    },
    finishQuery: () => query,
    search: files.queryChunks,
    retry: files.reindexFile,
    setModel: (model: string) => {
      getConfig().repository = { embedder: model };
      refreshConfig((revision) => revision + 1);
    },
    flush: flushPersistence,
    read: opfs.readJson,
  };
  window.ingestionE2E = api;
  return <>{agents.currentAgent ? <FilesSection agent={agents.currentAgent} /> : <span>Ready</span>}</>;
}

declare global {
  interface Window {
    ingestionE2E: {
      state: () => {
        agents: ReturnType<typeof useAgents>["agents"];
        current: ReturnType<typeof useAgents>["currentAgent"];
      };
      createAgent: ReturnType<typeof useAgents>["createAgent"];
      deleteAgent: ReturnType<typeof useAgents>["deleteAgent"];
      select: (id: string) => void;
      remove: ReturnType<typeof useAgentFiles>["removeFile"];
      startAdd: (name?: string, text?: string) => void;
      startTwo: () => void;
      startBatch: () => void;
      finish: () => Promise<void>;
      startQuery: (text: string) => void;
      finishQuery: () => ReturnType<ReturnType<typeof useAgentFiles>["queryChunks"]>;
      search: ReturnType<typeof useAgentFiles>["queryChunks"];
      retry: ReturnType<typeof useAgentFiles>["reindexFile"];
      setModel: (model: string) => void;
      flush: typeof flushPersistence;
      read: typeof opfs.readJson;
    };
    showIngestionOwner: (show: boolean) => void;
  }
}

function Owner() {
  const [show, setShow] = useState(true);
  window.showIngestionOwner = setShow;
  return show ? (
    <AgentProvider>
      <Fixture />
    </AgentProvider>
  ) : null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Owner />
  </StrictMode>,
);
