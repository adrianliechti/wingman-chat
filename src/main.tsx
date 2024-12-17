import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.tsx";

import { loadConfig } from "./config.ts";

const bootstrap = async () => {
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
    console.error("unable to load config", error);
  }
};

bootstrap();
