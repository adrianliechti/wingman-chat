interface ReportViewerProps {
  content: string;
}

export function ReportViewer({ content }: ReportViewerProps) {
  return (
    <div className="h-full p-4">
      <iframe
        srcDoc={content}
        sandbox="allow-scripts allow-same-origin"
        title="Report"
        className="w-full h-full border-0 rounded-lg bg-white"
      />
    </div>
  );
}
