import { createRoot } from "react-dom/client";
// @ts-expect-error The stylesheet is loaded by the browser's Vite dev server.
import "../../../src/index.css";
import { bytesToDataUrl } from "../../../src/shared/lib/fileContent";
import { DocxEditor } from "../../../src/shared/ui/editors/DocxEditor";
import { PptxEditor } from "../../../src/shared/ui/editors/PptxEditor";
import { XlsxEditor } from "../../../src/shared/ui/editors/XlsxEditor";

const host = document.getElementById("root");
if (!host) throw new Error("Missing Office editor test root");
const root = createRoot(host);

window.officeEditorsE2E = {
  renderDocx(bytes: number[]) {
    root.render(
      <DocxEditor
        path="/document.docx"
        content={bytesToDataUrl(
          new Uint8Array(bytes),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )}
      />,
    );
  },
  renderPptx(bytes: number[]) {
    root.render(
      <PptxEditor
        path="/presentation.pptx"
        content={bytesToDataUrl(
          new Uint8Array(bytes),
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )}
      />,
    );
  },
  renderXlsx(bytes: number[]) {
    root.render(
      <XlsxEditor
        path="/workbook.xlsx"
        content={bytesToDataUrl(
          new Uint8Array(bytes),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )}
      />,
    );
  },
};

declare global {
  interface Window {
    officeEditorsE2E: {
      renderDocx(bytes: number[]): void;
      renderPptx(bytes: number[]): void;
      renderXlsx(bytes: number[]): void;
    };
  }
}
