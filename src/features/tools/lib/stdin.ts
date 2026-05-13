import type { CommandContext } from "just-bash/browser";

const decoder = new TextDecoder("utf-8", { fatal: false });

// just-bash v3 types `ctx.stdin` as an opaque `ByteString` (latin1 byte
// buffer where each char is one byte). The browser entry doesn't re-export
// `decodeBytesToUtf8`, so decode here for commands that treat stdin as text.
export function decodeStdin(stdin: CommandContext["stdin"]): string {
  const raw = stdin as unknown as string;
  if (!raw) return "";
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return decoder.decode(bytes);
}
