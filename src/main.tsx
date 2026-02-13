import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.tsx";

import { loadConfig } from "./shared/config.ts";
import { runMigration } from "./features/settings/lib/migration.ts";

/**
 * Display a fatal error message to the user when the app fails to start.
 */
const showFatalError = (title: string, message: string, error?: unknown) => {
  console.error(title, message, error);
  
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        padding: 2rem;
        font-family: system-ui, -apple-system, sans-serif;
        background: #1a1a1a;
        color: #fff;
        text-align: center;
      ">
        <h1 style="margin: 0 0 1rem; color: #ef4444;">${title}</h1>
        <p style="margin: 0 0 1rem; max-width: 500px; color: #a1a1aa;">${message}</p>
        ${error ? `<pre style="
          margin: 1rem 0;
          padding: 1rem;
          background: #27272a;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          color: #fca5a5;
          max-width: 600px;
          overflow: auto;
          text-align: left;
        ">${error instanceof Error ? error.message : String(error)}</pre>` : ''}
        <button onclick="location.reload()" style="
          margin-top: 1rem;
          padding: 0.75rem 1.5rem;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 0.5rem;
          cursor: pointer;
          font-size: 1rem;
        ">Reload Page</button>
      </div>
    `;
  }
};

const bootstrap = async () => {
  try {
    // Run migration from IndexedDB to OPFS (if needed)
    await runMigration();
  } catch (error) {
    showFatalError(
      "Migration Failed",
      "Failed to migrate your data to the new storage format. Your data has not been lost. Please try reloading the page or contact support if the issue persists.",
      error
    );
    return;
  }
  
  try {
    const config = await loadConfig();

    if (config?.title) {
      document.title = config.title;
    }

    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (error) {
    showFatalError(
      "Failed to Start",
      "Unable to load the application configuration. Please check your network connection and try again.",
      error
    );
  }
};

bootstrap();
