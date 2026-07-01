import { memo } from "react";
import { RendererFrame } from "./RendererFrame";

interface PdfRendererProps {
  src: string;
  name?: string;
}

const NonMemoizedPdfRenderer = ({ src, name }: PdfRendererProps) => {
  return (
    <RendererFrame label="PDF" name={name}>
      <iframe
        src={src}
        className="w-full"
        style={{ height: "400px", minHeight: "200px", border: "none" }}
        title={`Preview of ${name || "PDF Document"}`}
      />
    </RendererFrame>
  );
};

export const PdfRenderer = memo(
  NonMemoizedPdfRenderer,
  (prevProps, nextProps) => prevProps.src === nextProps.src && prevProps.name === nextProps.name,
);
