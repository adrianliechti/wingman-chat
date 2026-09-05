import { Role, type Message } from "../types/chat";

/** Capture once per run so tool-loop requests keep the same prefix. */
export function captureRequestContext(providerContext = "", now = new Date()): string {
  const details = [
    `Current date and time: ${now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}`,
    `ISO 8601 (UTC): ${now.toISOString()}`,
    `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ];
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const platform = window.innerWidth < 768 ? "mobile" : "desktop";
    const pointer = window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    details.push(`Client: ${platform}, ${pointer}, ${theme} theme`);
  }
  if (providerContext.trim()) details.push(providerContext.trim());
  return `<context>\n${details.join("\n")}\n</context>`;
}

/** Wire-only metadata on the latest human turn, never a tool result or saved history. */
export function injectRequestContext(messages: Message[], context: string): Message[] {
  const index = messages.findLastIndex(
    (message) =>
      message.role === Role.User &&
      message.content.some((part) => part.type !== "tool_result" && part.type !== "runtime_feedback"),
  );
  if (index < 0 || !context.trim()) return messages;
  return messages.map((message, i) =>
    i === index ? { ...message, content: [...message.content, { type: "text", text: context }] } : message,
  );
}
