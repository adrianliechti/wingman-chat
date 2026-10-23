import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { MermaidEditor } from "../../../src/shared/ui/editors/MermaidEditor";

const host = document.getElementById("root");
if (!host) throw new Error("Missing mermaid test root");
const root = createRoot(host);

window.mermaidE2E = {
  render(content: string) {
    root.render(<MermaidEditor content={content} />);
  },
};

declare global {
  interface Window {
    mermaidE2E: {
      render(content: string): void;
    };
  }
}
