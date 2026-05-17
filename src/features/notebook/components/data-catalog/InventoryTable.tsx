import { useMemo, useState } from "react";
import type { Dataset, DataCatalog } from "../../types/notebook";

interface InventoryTableProps {
  catalog: DataCatalog;
}

const SENSITIVITY_TINT: Record<string, string> = {
  public: "#dcfce7",
  internal: "#dbeafe",
  confidential: "#fef3c7",
  restricted: "#fee2e2",
};

const SENSITIVITY_INK: Record<string, string> = {
  public: "#166534",
  internal: "#1e40af",
  confidential: "#92400e",
  restricted: "#991b1b",
};

export function InventoryTable({ catalog }: InventoryTableProps) {
  const grouped = useMemo(() => groupByDomain(catalog.datasets), [catalog.datasets]);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const glossaryById = useMemo(() => new Map(catalog.glossary.map((t) => [t.id, t])), [catalog.glossary]);

  return (
    <div className="h-full w-full overflow-auto px-6 pt-6 pb-24 bg-white dark:bg-neutral-950">
      {grouped.map(({ domain, datasets }) => (
        <section key={domain} className="mb-8">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
            {domain}
            <span className="ml-2 font-normal opacity-60">({datasets.length})</span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 dark:bg-neutral-900/60">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2">System</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Refresh</th>
                  <th className="px-3 py-2">Sensitivity</th>
                  <th className="px-3 py-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-neutral-100 dark:border-neutral-800 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                    onClick={() => setSelected(d)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-neutral-800 dark:text-neutral-100 truncate">{d.title}</p>
                          <p className="text-[10px] font-mono text-neutral-500 dark:text-neutral-500 truncate">
                            {d.name}
                          </p>
                        </div>
                        {d.inferred && <InferredBadge />}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{d.system ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{d.owner ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{d.refreshCadence ?? "—"}</td>
                    <td className="px-3 py-2">
                      {d.sensitivity ? (
                        <span
                          style={{
                            background: SENSITIVITY_TINT[d.sensitivity] ?? "#e2e8f0",
                            color: SENSITIVITY_INK[d.sensitivity] ?? "#0f172a",
                          }}
                          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                        >
                          {d.sensitivity}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(d.regulatoryTags ?? []).slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {selected && (
        <DatasetDrawer
          dataset={selected}
          onClose={() => setSelected(null)}
          glossaryFor={(id) => glossaryById.get(id)?.term ?? id}
        />
      )}
    </div>
  );
}

function groupByDomain(datasets: Dataset[]): { domain: string; datasets: Dataset[] }[] {
  const map = new Map<string, Dataset[]>();
  for (const d of datasets) {
    const k = d.domain ?? "Other";
    const arr = map.get(k) ?? [];
    arr.push(d);
    map.set(k, arr);
  }
  return Array.from(map.entries()).map(([domain, datasets]) => ({ domain, datasets }));
}

function InferredBadge() {
  return (
    <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 tracking-wider shrink-0">
      INFERRED
    </span>
  );
}

function DatasetDrawer({
  dataset,
  onClose,
  glossaryFor,
}: {
  dataset: Dataset;
  onClose: () => void;
  glossaryFor: (id: string) => string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30 cursor-default" onClick={onClose} />
      <aside className="relative w-full max-w-md h-full bg-white dark:bg-neutral-950 shadow-2xl overflow-y-auto p-6">
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-xs font-mono text-neutral-500">{dataset.name}</p>
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{dataset.title}</h2>
            {dataset.description && (
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{dataset.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 text-sm"
          >
            ✕
          </button>
        </header>

        <Section label="Ownership">
          {dataset.owner && <KV k="Owner" v={dataset.owner} />}
          {dataset.steward && <KV k="Steward" v={dataset.steward} />}
          {dataset.contact && <KV k="Contact" v={dataset.contact} />}
        </Section>

        <Section label="Storage">
          {dataset.system && <KV k="System" v={dataset.system} />}
          {dataset.location && <KV k="Location" v={<code className="text-[11px]">{dataset.location}</code>} />}
          {dataset.refreshCadence && <KV k="Refresh" v={dataset.refreshCadence} />}
          {dataset.sla && <KV k="SLA" v={dataset.sla} />}
        </Section>

        {(dataset.sensitivity || (dataset.regulatoryTags && dataset.regulatoryTags.length > 0)) && (
          <Section label="Classification">
            {dataset.sensitivity && <KV k="Sensitivity" v={dataset.sensitivity} />}
            {dataset.regulatoryTags && dataset.regulatoryTags.length > 0 && (
              <KV k="Regulatory" v={dataset.regulatoryTags.join(", ")} />
            )}
          </Section>
        )}

        {dataset.fields && dataset.fields.length > 0 && (
          <Section label="Fields">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-neutral-50 dark:bg-neutral-900/60">
                  <tr className="text-left text-[10px] font-semibold uppercase text-neutral-500">
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1">Notation</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.fields.map((f) => (
                    <tr key={f.name} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="px-2 py-1 font-mono">{f.name}</td>
                      <td className="px-2 py-1 text-neutral-600 dark:text-neutral-400">{f.type ?? "—"}</td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          {f.primaryKey && <Pill text="PK" tint="#fde68a" />}
                          {f.nullable === false && <Pill text="NN" tint="#e2e8f0" />}
                          {f.classification && <Pill text={f.classification} tint="#fecaca" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {dataset.glossaryTerms && dataset.glossaryTerms.length > 0 && (
          <Section label="Glossary terms">
            <div className="flex flex-wrap gap-1">
              {dataset.glossaryTerms.map((id) => (
                <span
                  key={id}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                >
                  {glossaryFor(id)}
                </span>
              ))}
            </div>
          </Section>
        )}
      </aside>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1.5">
        {label}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-20 shrink-0 text-neutral-500 dark:text-neutral-400">{k}</span>
      <span className="flex-1 text-neutral-800 dark:text-neutral-200">{v}</span>
    </div>
  );
}

function Pill({ text, tint }: { text: string; tint: string }) {
  return (
    <span
      style={{ background: tint }}
      className="text-[9px] font-bold px-1 py-0.5 rounded text-neutral-800 tracking-wider"
    >
      {text}
    </span>
  );
}
