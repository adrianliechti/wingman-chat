import { useMemo } from "react";
import type { DataCatalog, GlossaryTerm } from "../../types/notebook";

interface GlossaryViewProps {
  catalog: DataCatalog;
}

export function GlossaryView({ catalog }: GlossaryViewProps) {
  const datasetTitleById = useMemo(() => new Map(catalog.datasets.map((d) => [d.id, d.title])), [catalog.datasets]);
  const sorted = useMemo(() => [...catalog.glossary].sort((a, b) => a.term.localeCompare(b.term)), [catalog.glossary]);
  const grouped = useMemo(() => groupByLetter(sorted), [sorted]);

  return (
    <div className="h-full w-full overflow-auto px-3 pt-6 pb-24">
      {grouped.map(({ letter, terms }) => (
        <section key={letter} className="mb-8">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
            {letter}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {terms.map((t) => (
              <TermCard key={t.id} term={t} datasetTitleFor={(id) => datasetTitleById.get(id) ?? id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TermCard({ term, datasetTitleFor }: { term: GlossaryTerm; datasetTitleFor: (id: string) => string }) {
  return (
    <article
      className={`rounded-xl border p-3 ${
        term.inferred
          ? "border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/30"
          : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40"
      }`}
    >
      <header className="flex items-start justify-between gap-2 mb-1">
        <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{term.term}</h4>
        {term.inferred && (
          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 tracking-wider shrink-0">
            INFERRED
          </span>
        )}
      </header>

      <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed mb-2">{term.definition}</p>

      {term.synonyms && term.synonyms.length > 0 && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
          <span className="font-semibold">Also known as:</span> {term.synonyms.join(", ")}
        </p>
      )}

      {term.ontologyReference && (
        <p className="text-xs mb-2 break-all">
          <span className="font-semibold text-neutral-500 dark:text-neutral-400">Ontology:</span>{" "}
          <a
            href={term.ontologyReference}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            {term.ontologyReference}
          </a>
        </p>
      )}

      {term.datasets && term.datasets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {term.datasets.map((id) => (
            <span
              key={id}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
            >
              {datasetTitleFor(id)}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function groupByLetter(terms: GlossaryTerm[]): { letter: string; terms: GlossaryTerm[] }[] {
  const map = new Map<string, GlossaryTerm[]>();
  for (const t of terms) {
    const k = (t.term[0] ?? "?").toUpperCase();
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  return Array.from(map.entries()).map(([letter, terms]) => ({ letter, terms }));
}
