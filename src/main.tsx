import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";

import { ThemeProvider } from "./components/ThemeProvider.tsx";
import { SidebarProvider } from "./components/ui/Sidebar.tsx";
import { loadConfig } from "./config.ts";

const bootstrap = async () => {
  try {
    const config = await loadConfig();

    if (config?.title) {
      document.title = config.title;
    }

    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ThemeProvider>
          <SidebarProvider>
            <App />
          </SidebarProvider>
        </ThemeProvider>
      </StrictMode>
    );
  } catch (error) {
    console.error("unable to load config", error);
  }
};

bootstrap();
