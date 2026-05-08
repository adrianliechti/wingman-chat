import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { memo, useEffect, useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfEditorProps {
    content: string;
}

export const PdfEditor = memo(function PdfEditor({ content }: PdfEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!content || !containerRef.current) return;

        const container = containerRef.current;
        let cancelled = false;

        const render = async () => {
            try {
                // Convert data: URL to Uint8Array
                const base64 = content.split(",")[1];
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

                const pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
                if (cancelled) return;

                container.innerHTML = "";

                for (let i = 1; i <= pdf.numPages; i++) {
                    if (cancelled) break;

                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: window.devicePixelRatio >= 2 ? 2 : 1.5 });

                    const canvas = document.createElement("canvas");
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    canvas.style.width = "100%";
                    canvas.style.display = "block";
                    canvas.style.marginBottom = "8px";
                    canvas.style.borderRadius = "4px";
                    canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,0.15)";

                    container.appendChild(canvas);

                    const ctx = canvas.getContext("2d");
                    if (!ctx) continue;
                    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to render PDF");
            }
        };

        render();

        return () => {
            cancelled = true;
            container.innerHTML = "";
        };
    }, [content]);

    if (error) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-red-500 p-8">{error}</div>
        );
    }

    return (
        <div className="h-full overflow-auto">
            <div ref={containerRef} className="max-w-4xl mx-auto" />
        </div>
    );
});
