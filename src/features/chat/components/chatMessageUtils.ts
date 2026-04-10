// Helper function to extract and format common parameters for tool calls
export function getToolCallPreview(_toolName: string, arguments_: string): string | null {
  try {
    const args = JSON.parse(arguments_);

    // Common parameter names to look for (in order of preference)
    // Prioritize short, descriptive fields over potentially long content
    const commonParams = [
      // Identification (short & descriptive)
      "title",
      "name",
      "label",
      // Location (usually short)
      "city",
      "location",
      "place",
      // Web & Network (usually concise)
      "url",
      "link",
      "uri",
      "endpoint",
      "address",
      // Files & Paths (usually concise)
      "filename",
      "file",
      "path",
      "filepath",
      "folder",
      "directory",
      // Communication (usually short)
      "subject",
      "email",
      "recipient",
      "to",
      // Commands (usually short)
      "command",
      // Search & Query (can vary in length, but often short)
      "query",
      "search",
      "keyword",
      "q",
      "search_query",
      "term",
      // Short inputs
      "question",
      "input",
      "value",
      // Potentially long content (last resort)
      "message",
      "prompt",
      "instruction",
      "text",
      "content",
      "body",
      "data",
    ];

    // Find the first matching parameter
    for (const param of commonParams) {
      if (args[param] && typeof args[param] === "string") {
        return args[param];
      }
    }

    return null;
  } catch {
    return null;
  }
}
