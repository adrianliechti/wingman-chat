import { loadPyodide as loadPyodideRuntime, version as pyodideVersion, type PyodideInterface } from 'pyodide';

export interface CodeExecutionRequest {
  code: string;
  packages?: string[];
  files?: Record<string, { content: string; contentType?: string }>;
}

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

let pyodideInstance: PyodideInterface | null = null;
let pyodideLoading: Promise<PyodideInterface> | null = null;
const loadedPackages = new Set<string>();

async function loadPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  if (pyodideLoading) {
    return pyodideLoading;
  }

  pyodideLoading = (async () => {
    try {
      const indexURL = import.meta.env.DEV 
        ? `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`
        : '/assets/pyodide/';
      
      pyodideInstance = await loadPyodideRuntime({
        indexURL,
      });
      
      console.log(`Pyodide v${pyodideVersion} loaded successfully from ${import.meta.env.DEV ? 'CDN' : 'local assets'}`);
      return pyodideInstance;
    } catch (error) {
      console.error('Failed to load Pyodide:', error);
      pyodideLoading = null;
      throw error;
    }
  })();

  return pyodideLoading;
}

export async function executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
  const { code, packages = [], files = {} } = request;

  try {
    const pyodide = await loadPyodide();

    // Sync artifact files to Pyodide's virtual filesystem
    // Write to /home/pyodide which is the default working directory
    const baseDir = '/home/pyodide';
    for (const [path, file] of Object.entries(files)) {
      // Normalize path - remove leading slash if present, then prepend base dir
      const relativePath = path.startsWith('/') ? path.slice(1) : path;
      const fsPath = `${baseDir}/${relativePath}`;
      
      // Ensure parent directories exist
      const dir = fsPath.substring(0, fsPath.lastIndexOf('/'));
      if (dir) {
        try {
          pyodide.FS.mkdirTree(dir);
        } catch {
          // Directory may already exist
        }
      }
      
      // Write file - detect binary content types
      const isBinary = file.contentType?.startsWith('image/') ||
                       file.contentType?.startsWith('audio/') ||
                       file.contentType?.startsWith('video/') ||
                       file.contentType === 'application/octet-stream';
      
      if (isBinary) {
        // Convert base64 to Uint8Array for binary files
        const binaryString = atob(file.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        pyodide.FS.writeFile(fsPath, bytes);
      } else {
        // Write text content directly (Pyodide FS handles string encoding)
        pyodide.FS.writeFile(fsPath, file.content);
      }
    }

    if (packages.length > 0) {
      try {
        await pyodide.loadPackagesFromImports(code);
        
        for (const pkg of packages) {
          if (!loadedPackages.has(pkg)) {
            try {
              await pyodide.loadPackage(pkg);
              loadedPackages.add(pkg);
            } catch {
              console.warn(`Package ${pkg} not available in Pyodide, skipping`);
            }
          }
        }
      } catch (error) {
        console.warn('Error loading packages:', error);
      }
    }

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

    const result = await pyodide.runPythonAsync(code);

    if (result !== undefined && result !== null && !output.trim()) {
      output = String(result);
    }

    return {
      success: true,
      output: output.trim() || 'Code executed successfully (no output)',
    };
  } catch (error) {
    console.error('Code execution error:', error);
    
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
