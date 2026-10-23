import { createRoot } from "react-dom/client";
import { FileSystemManager } from "../../../src/features/artifacts/lib/fs";
import { executeJavaScript } from "../../../src/features/tools/lib/javascript";
import { HtmlPreview } from "../../../src/shared/ui/HtmlPreview";

const root = createRoot(document.getElementById("root")!);
const fs = new FileSystemManager(`html-libraries-${crypto.randomUUID()}`);

window.htmlArtifactsE2E = {
  async create(code) {
    const result = await executeJavaScript({ code });
    if (result.success && result.files) await fs.applyOverlaySnapshot(result.files, { deleteMissing: true });
    return { success: result.success, error: result.error, paths: Object.keys(result.files ?? {}) };
  },
  preview(path) {
    root.render(<HtmlPreview path={path} fs={fs} style={{ width: 400, height: 300 }} />);
  },
  async read(path) {
    return (await fs.getFile(path))?.content;
  },
  async write(path, content) {
    await fs.createFile(path, content);
  },
  async exportZip() {
    const bytes = new Uint8Array(await (await fs.exportZip()).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  },
};

declare global {
  interface Window {
    htmlArtifactsE2E: {
      create(code: string): Promise<{ success: boolean; error?: string; paths: string[] }>;
      preview(path: string): void;
      read(path: string): Promise<string | undefined>;
      write(path: string, content: string): Promise<void>;
      exportZip(): Promise<string>;
    };
  }
}
