import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

interface CatalogBreadcrumbProps {
  parents: { label: string; onClick: () => void }[];
  title: string;
}

export function CatalogBreadcrumb({ parents, title }: CatalogBreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {parents.map((parent, index) => (
          <Fragment key={index}>
            <li className="min-w-0 max-w-[30%] shrink-0">
              <button
                type="button"
                onClick={parent.onClick}
                title={`Back to ${parent.label}`}
                className="block max-w-full truncate rounded px-1 py-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                {parent.label}
              </button>
            </li>
            <li aria-hidden="true" className="shrink-0 text-neutral-300 dark:text-neutral-600">
              <ChevronRight size={13} />
            </li>
          </Fragment>
        ))}
        <li aria-current="page" className="min-w-0 text-neutral-900 dark:text-neutral-100">
          <span className="block truncate px-1 py-1" title={title}>
            {title}
          </span>
        </li>
      </ol>
    </nav>
  );
}
