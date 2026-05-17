import { useMemo } from "react";
import type { DataCatalog, DataContract, Dataset } from "../../types/notebook";

interface ContractCardsProps {
  catalog: DataCatalog;
}

export function ContractCards({ catalog }: ContractCardsProps) {
  const datasetById = useMemo(() => new Map(catalog.datasets.map((d) => [d.id, d])), [catalog.datasets]);

  if (catalog.contracts.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-neutral-400">
        No contracts in this catalog — switch to Inventory or refine to add some.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto px-6 pt-6 pb-24 bg-white dark:bg-neutral-950">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {catalog.contracts.map((c) => {
          const ds = datasetById.get(c.datasetId);
          if (!ds) return null;
          return <ContractCard key={c.datasetId} contract={c} dataset={ds} />;
        })}
      </div>
    </div>
  );
}

function ContractCard({ contract, dataset }: { contract: DataContract; dataset: Dataset }) {
  return (
    <article
      className={`rounded-xl border p-4 ${
        contract.inferred
          ? "border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/30"
          : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40"
      }`}
    >
      <header className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-mono text-neutral-500">{dataset.name}</p>
            <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{dataset.title}</h4>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {contract.version && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                {contract.version}
              </span>
            )}
            {contract.inferred && (
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 tracking-wider">
                INFERRED
              </span>
            )}
          </div>
        </div>
        {dataset.owner && (
          <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
            <span className="font-semibold">Owner:</span> {dataset.owner}
            {dataset.steward && (
              <>
                {" "}
                · <span className="font-semibold">Steward:</span> {dataset.steward}
              </>
            )}
          </p>
        )}
      </header>

      {contract.purpose && (
        <Section label="Purpose">
          <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">{contract.purpose}</p>
        </Section>
      )}

      {contract.qualityRules && contract.qualityRules.length > 0 && (
        <Section label="Quality rules">
          <ul className="space-y-1">
            {contract.qualityRules.map((r) => (
              <li key={r} className="text-xs text-neutral-700 dark:text-neutral-300 flex gap-2">
                <span className="text-neutral-400 shrink-0">✓</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {contract.terms && contract.terms.length > 0 && (
        <Section label="Terms">
          <dl className="space-y-1.5">
            {contract.terms.map((t) => (
              <div key={t.term}>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  {t.term}
                </dt>
                <dd className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">{t.commitment}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </article>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h5 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
        {label}
      </h5>
      {children}
    </section>
  );
}
