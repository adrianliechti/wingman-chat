import { BookMarked, Loader2, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { refineDataCatalog } from "../lib/data-catalog-refine";
import type { NotebookOutput } from "../types/notebook";
import { ContractCards } from "./data-catalog/ContractCards";
import { GlossaryView } from "./data-catalog/GlossaryView";
import { InventoryTable } from "./data-catalog/InventoryTable";
import { LineageGraph } from "./data-catalog/LineageGraph";

interface DataCatalogViewerProps {
  output: NotebookOutput;
  onRefine?: (updatedOutput: NotebookOutput) => void;
}

const KIND_LABEL: Record<string, string> = {
  inventory: "Inventory · DCAT",
  glossary: "Glossary · SKOS/FIBO",
  lineage: "Lineage · OpenLineage",
  contracts: "Contracts · ODCS",
};

export function DataCatalogViewer({ output, onRefine }: DataCatalogViewerProps) {
  const catalog = output.dataCatalog;
  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [showDots, setShowDots] = useState(true);

  if (!catalog) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-neutral-400">No data catalog</div>
    );
  }

  const isLineage = catalog.kind === "lineage";

  const handleRefine = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!refinePrompt.trim() || isRefining) return;
    setIsRefining(true);
    setRefineError(null);
    try {
      const updated = await refineDataCatalog(output, refinePrompt.trim());
      if (updated !== output) onRefine?.(updated);
      setRefinePrompt("");
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-neutral-950">
      {/* Header — in document flow so the content doesn't slide under it. */}
      <header className="shrink-0 flex items-start gap-3 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <BookMarked size={13} className="text-neutral-500 shrink-0" />
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 truncate">{catalog.title}</p>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 uppercase tracking-wider shrink-0">
              {KIND_LABEL[catalog.kind] ?? catalog.kind}
            </span>
          </div>
          {catalog.summary && (
            <p className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
              {catalog.summary}
            </p>
          )}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-neutral-400">
            <span>{catalog.datasets.length} datasets</span>
            <span>{catalog.glossary.length} terms</span>
            <span>{catalog.lineageNodes.length} lineage nodes</span>
            <span>{catalog.contracts.length} contracts</span>
          </div>
        </div>
        {isLineage && (
          <div className="shrink-0 flex items-center gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setShowDots((v) => !v)}
              className={`px-2 py-1 rounded-lg border transition-colors text-[10px] font-semibold tracking-wide ${
                showDots
                  ? "bg-neutral-800 dark:bg-neutral-200 border-neutral-800 dark:border-neutral-200 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
              title={showDots ? "Hide dot grid" : "Show dot grid"}
              aria-pressed={showDots}
            >
              Grid
            </button>
          </div>
        )}
      </header>

      {/* Content area */}
      <div className="flex-1 min-h-0 relative">
        {catalog.kind === "inventory" && <InventoryTable catalog={catalog} />}
        {catalog.kind === "glossary" && <GlossaryView catalog={catalog} />}
        {catalog.kind === "lineage" && <LineageGraph catalog={catalog} showDots={showDots} />}
        {catalog.kind === "contracts" && <ContractCards catalog={catalog} />}

        {/* Refine — floats above content */}
        <div className="absolute bottom-4 left-4 right-4 z-20">
          <form onSubmit={handleRefine}>
            <div className="flex items-center gap-2 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-neutral-700/40 shadow-lg shadow-black/5 dark:shadow-black/20 p-3">
              <input
                type="text"
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                placeholder={placeholderFor(catalog.kind)}
                disabled={isRefining || output.status === "generating"}
                className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none"
              />
              <button
                type="submit"
                disabled={!refinePrompt.trim() || isRefining || output.status === "generating"}
                className="p-1.5 rounded-lg bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-800 disabled:opacity-30 transition-opacity"
              >
                {isRefining ? <Loader2 size={14} className="animate-spin" /> : <SparklesIcon size={14} />}
              </button>
            </div>
            {refineError && <p className="text-[10px] text-red-500 mt-1 px-3">{refineError}</p>}
          </form>
        </div>
      </div>

    </div>
  );
}

function placeholderFor(kind: string): string {
  switch (kind) {
    case "inventory":
      return "Refine… e.g. add a Kafka topic `trades.events.v1` with PII tagging";
    case "glossary":
      return "Refine… e.g. add a 'Risk-Weighted Asset' term linked to BCBS 239";
    case "lineage":
      return "Refine… e.g. add a dbt model that produces the EOD exposure table";
    case "contracts":
      return "Refine… e.g. add a freshness term of T+1 06:00 UTC on the trade dataset";
    default:
      return "Refine this catalog…";
  }
}
