import { HtmlPreview } from "@/shared/ui/HtmlPreview";

interface ReportViewerProps {
  content: string;
}

export function ReportViewer({ content }: ReportViewerProps) {
  return (
    <div className="h-full p-4">
      <HtmlPreview
        content={content}
        path="report.html"
        title="Report"
        className="w-full h-full border-0 rounded-lg bg-white"
        reloadDebounceMs={250}
      />
    </div>
  );
}
