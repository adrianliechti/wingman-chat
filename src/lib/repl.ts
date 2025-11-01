/**
 * Python REPL using Pyodide
 * Executes Python code in the browser with optional packages
 */

import { loadPyodide as loadPyodideRuntime, version as pyodideVersion, type PyodideInterface } from 'pyodide';

export interface ReplExecutionRequest {
  code: string;
  packages?: string[];
}

export interface ReplExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

// Pyodide singleton instance
let pyodideInstance: PyodideInterface | null = null;
let pyodideLoading: Promise<PyodideInterface> | null = null;

/**
 * Load Pyodide runtime
 */
async function loadPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  if (pyodideLoading) {
    return pyodideLoading;
  }

  pyodideLoading = (async () => {
    try {
      // Initialize Pyodide from CDN (recommended approach)
      // Version automatically matches the npm package version
      pyodideInstance = await loadPyodideRuntime({
        indexURL: `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`,
      });
      
      console.log(`Pyodide v${pyodideVersion} loaded successfully`);
      return pyodideInstance;
    } catch (error) {
      console.error('Failed to load Pyodide:', error);
      pyodideLoading = null;
      throw error;
    }
  })();

  return pyodideLoading;
}

/**
 * Execute Python code with optional package dependencies
 * Uses Pyodide to run Python in the browser
 */
export async function executeCode(request: ReplExecutionRequest): Promise<ReplExecutionResult> {
  const { code, packages = [] } = request;

  try {
    // Load Pyodide
    const pyodide = await loadPyodide();

    // Install required packages
    if (packages.length > 0) {
      try {
        await pyodide.loadPackagesFromImports(code);
        for (const pkg of packages) {
          try {
            await pyodide.loadPackage(pkg);
          } catch (pkgError) {
            console.warn(`Package ${pkg} not available in Pyodide, skipping`);
          }
        }
      } catch (error) {
        console.warn('Error loading packages:', error);
      }
    }

    // Capture stdout
    let output = '';
    pyodide.setStdout({
      batched: (text: string) => {
        output += text + '\n';
      }
    });

    pyodide.setStderr({
      batched: (text: string) => {
        output += text + '\n';
      }
    });

    // Execute the code
    const result = await pyodide.runPythonAsync(code);

    // If there's a result and no output, show the result
    if (result !== undefined && result !== null && !output.trim()) {
      output = String(result);
    }

    return {
      success: true,
      output: output.trim() || 'Code executed successfully (no output)',
    };
  } catch (error: any) {
    console.error('Python execution error:', error);
    
    return {
      success: false,
      output: '',
      error: error.message || String(error),
    };
  }
}
