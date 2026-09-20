import { StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../../src/shared/ui/Markdown";
import { prepareInitialEmojiRendering, type EmojiMode } from "../../../src/shared/lib/noto-emoji";
import { EmojiProvider } from "../../../src/shell/context/EmojiProvider";
import { ThemeProvider } from "../../../src/shell/context/ThemeProvider";
import { useEmoji } from "../../../src/shell/hooks/useEmoji";
import type { FileSystem } from "../../../src/shared/types/file";
import "../../../src/index.css";

let releaseImage: () => void = () => {};
const imageReady = new Promise<void>((resolve) => {
  releaseImage = resolve;
});
const fs = {
  getFile: async () => {
    await imageReady;
    return {
      content: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
      contentType: "image/svg+xml",
    };
  },
  subscribe: () => () => {},
} as unknown as FileSystem;

function Fixture() {
  const [state, setState] = useState({ content: "Ready", streaming: false, files: false, compact: false });
  const { setEmojiMode } = useEmoji();
  useLayoutEffect(() => {
    window.markdownE2E = {
      render: (content, streaming = false, files = false, compact = false) =>
        setState({ content, streaming, files, compact }),
      mode: setEmojiMode,
      releaseImage,
    };
  }, [setEmojiMode]);
  return (
    <div data-testid="markdown" style={{ padding: 24, fontSize: 20 }}>
      <Markdown
        isStreaming={state.streaming}
        compact={state.compact}
        fs={state.files ? fs : undefined}
        basePath="/docs/readme.md"
      >
        {state.content}
      </Markdown>
    </div>
  );
}

prepareInitialEmojiRendering();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <EmojiProvider>
        <Fixture />
      </EmojiProvider>
    </ThemeProvider>
  </StrictMode>,
);

declare global {
  interface Window {
    markdownE2E: {
      render(content: string, streaming?: boolean, files?: boolean, compact?: boolean): void;
      mode(mode: EmojiMode): void;
      releaseImage(): void;
    };
  }
}
