import type { PyodideInterface } from "pyodide";

// pandas imports these engines lazily, so scanning the user's imports cannot
// discover them. Install the bundled engines before user code can run; the
// runtime keeps them loaded for subsequent executions.
const PANDAS_OPTIONAL_PACKAGES = ["openpyxl", "xlrd", "python-calamine", "xlsxwriter", "pyarrow", "tabulate"];

// zoneinfo/pandas read tzdata without importing it; pytz has its own database.
const TZDATA_USAGE = /\bzoneinfo\b|\bZoneInfo\(|\.tz_localize\(|\.tz_convert\(|\btz\s*=\s*['"]/;

/** Load static imports and bundled dependencies that libraries import lazily. */
export async function loadPythonPackages(
  pyodide: PyodideInterface,
  sources: string[],
  errorCallback: (message: string) => void,
): Promise<void> {
  // Scan sources separately: concatenating local modules can change syntax.
  for (const source of sources) await pyodide.loadPackagesFromImports(source, { errorCallback });

  const extra = new Set<string>();
  if (pyodide.loadedPackages.pandas) {
    for (const name of PANDAS_OPTIONAL_PACKAGES) extra.add(name);
  }
  if (sources.some((source) => TZDATA_USAGE.test(source))) extra.add("tzdata");
  const unloaded = [...extra].filter((name) => !pyodide.loadedPackages[name]);
  // Load after pandas instead of adding a pandas -> pyarrow lock dependency:
  // pyarrow already depends on pandas, which would make the lock graph cyclic.
  if (unloaded.length) await pyodide.loadPackage(unloaded, { errorCallback });
}
