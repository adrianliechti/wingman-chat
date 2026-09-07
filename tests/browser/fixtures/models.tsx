import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useModels } from "../../../src/features/chat/hooks/useModels";
import { useRendererModels } from "../../../src/features/canvas/hooks/useRendererModels";
import { resolveModel } from "../../../src/features/tools/lib/commandUtils";
import { loadConfig } from "../../../src/shared/config";
import { useModelCatalog } from "../../../src/shared/hooks/useModelCatalog";
import { getModelCatalog } from "../../../src/shared/lib/modelCatalog";
import type { Model } from "../../../src/shared/types/chat";

const config = await loadConfig();
if (!config) throw new Error("Missing fixture config");
const catalog = getModelCatalog(config);

function Consumer() {
  const chat = useModels();
  const renderers = useRendererModels();
  const all = useModelCatalog();
  const state = { all, chat: chat.models, renderers, selected: chat.selectedModel };
  window.modelsE2E = {
    state: () => state,
    select: chat.setSelectedModel,
    refresh: () => catalog.refresh(true).then(() => undefined),
    resolveRenderer: () => resolveModel(undefined, "renderer"),
  };
  return <pre data-testid="state">{JSON.stringify(state)}</pre>;
}

function Fixture() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button onClick={() => setMounted((current) => !current)}>Toggle consumer</button>
      {mounted && <Consumer />}
    </>
  );
}

declare global {
  interface Window {
    modelsE2E: {
      state(): { all: Model[]; chat: Model[]; renderers: Model[]; selected: Model | null };
      select(model: Model | null): void;
      refresh(): Promise<void>;
      resolveRenderer(): Promise<string>;
    };
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
