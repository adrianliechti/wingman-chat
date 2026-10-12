/** Compact text for collapsed tool rows; full arguments remain in the expanded view. */
export function toolPreviewText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /^data:/i.test(text)) return null;
  return text.length > 160 ? `${text.slice(0, 159).trimEnd()}…` : text;
}

/** Virtual paths are displayed relative to the workspace, while retaining the root. */
export function toolPreviewPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return toolPreviewText(value.trim().replace(/^\/+/, "") || "/");
}

/** Keep batch previews readable without hiding that more items are being processed. */
export function toolPreviewList(value: unknown, noun = "items"): string | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(toolPreviewText).filter((item): item is string => item !== null);
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  return `${items.length} ${noun}: ${items.slice(0, 2).join(", ")}`;
}

export function toolPreviewResource(skill: unknown, resource: unknown): string | null {
  const name = toolPreviewText(skill);
  const path = toolPreviewPath(resource);
  return name && path ? `${name}/${path}` : (path ?? name);
}

/** Best-effort preview for tools without their own presentation, including MCP tools. */
export function getToolCallPreview(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  const params = [
    "title",
    "name",
    "label",
    "skill",
    "city",
    "location",
    "place",
    "url",
    "urls",
    "link",
    "uri",
    "endpoint",
    "address",
    "filename",
    "file_name",
    "fileName",
    "file",
    "path",
    "file_path",
    "filePath",
    "filepath",
    "file_paths",
    "filePaths",
    "paths",
    "folder",
    "directory",
    "subject",
    "email",
    "recipient",
    "to",
    "command",
    "cmd",
    "query",
    "queries",
    "search",
    "keyword",
    "q",
    "search_query",
    "term",
    "pattern",
    "question",
    "input",
    "value",
    "message",
    "prompt",
    "instructions",
    "instruction",
    "text",
  ];
  const pathParams = new Set([
    "filename",
    "file_name",
    "fileName",
    "file",
    "file_path",
    "filePath",
    "filepath",
    "path",
    "file_paths",
    "filePaths",
    "paths",
    "folder",
    "directory",
  ]);
  for (const param of params) {
    const value = args[param];
    const preview = Array.isArray(value)
      ? toolPreviewList(
          pathParams.has(param) ? value.map(toolPreviewPath) : value,
          pathParams.has(param) ? "files" : param === "queries" ? "queries" : param === "urls" ? "URLs" : "items",
        )
      : pathParams.has(param)
        ? toolPreviewPath(value)
        : toolPreviewText(value);
    if (preview) return toolPreviewText(preview);
  }
  return null;
}
