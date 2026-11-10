import { memo } from "react";
import { useHighlight } from "@/shared/hooks/useHighlight";
import { CopyButton } from "./CopyButton";
import { HighlightStyles } from "./HighlightStyles";
import { RendererFrame } from "./renderers/RendererFrame";

const codeStyle: React.CSSProperties = {
  fontFamily: "Fira Code, Monaco, Cascadia Code, Roboto Mono, monospace",
};

interface CodeRendererProps {
  code: string;
  language: string;
  name?: string;
  /** Strip the header bar and borders for inline contexts (e.g. tool details). */
  subtle?: boolean;
}

const CodeRenderer = memo(({ code, language, name, subtle = false }: CodeRendererProps) => {
  const tokens = useHighlight(code, language || "text");
  return (
    <RendererFrame
      label={subtle ? (name ?? "") : language}
      name={subtle ? undefined : name}
      actions={<CopyButton text={code} label="Copy" />}
      compact={subtle}
    >
      <HighlightStyles />
      <pre className="syntax-highlight m-0 p-3 text-sm leading-5 whitespace-pre overflow-x-auto" style={codeStyle}>
        <code>
          {tokens
            ? tokens.map((token, index) =>
                token.className ? (
                  <span key={index} className={`th-${token.className}`}>
                    {token.value}
                  </span>
                ) : (
                  token.value
                ),
              )
            : code}
        </code>
      </pre>
    </RendererFrame>
  );
});

CodeRenderer.displayName = "CodeRenderer";

export { CodeRenderer };
