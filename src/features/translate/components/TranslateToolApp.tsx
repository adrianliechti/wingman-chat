import { GlobeIcon, Loader2, SwatchBookIcon, ThermometerIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useChat } from "@/features/chat/hooks/useChat";
import { getConfig } from "@/shared/config";
import type { ToolResultContent } from "@/shared/types/chat";
import { CopyButton } from "@/shared/ui/CopyButton";
import { InteractiveText } from "@/shared/ui/InteractiveText";
import { RewritePopover } from "@/shared/ui/RewritePopover";
import { SelectorMenu } from "@/shared/ui/SelectorMenu";
import { styleOptions, supportedLanguages, toneOptions } from "../context/TranslateContext";
import { translateText } from "../lib/translate";

interface TranslateToolAppProps {
  toolResult: ToolResultContent;
  /** Index of the owning message — used to persist edits back into the chat. */
  index: number;
}

/**
 * Widget state saved on `tool_result.content` — the translation plus the selected
 * controls. `content` is never sent to the model (only `result` is), so this is
 * also where the editable translation lives, away from the model's view.
 */
interface TranslateState {
  language?: string;
  tone?: string;
  style?: string;
  text?: string;
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function resultText(toolResult: ToolResultContent): string {
  const first = toolResult.result?.find((c) => c.type === "text");
  return first?.type === "text" ? first.text : "";
}

/**
 * Inline, interactive translation widget rendered for `translate` tool results.
 * The translation and selected controls live on `tool_result.content` (which is
 * never sent to the model — only the tool's `result` status line is), so edits
 * (language/tone/style, word rewrites) persist across reloads without ever
 * re-entering the model's context, and the model doesn't echo the translation.
 * To reword it, the user just keeps chatting. The source isn't echoed here — it
 * shows in the ChatToolMessage header — so this is just controls → translation.
 */
export function TranslateToolApp({ toolResult, index }: TranslateToolAppProps) {
  const config = getConfig();
  const client = config.client;
  const model = config.translator?.model || "";
  const { chat, updateChat } = useChat();

  const languages = supportedLanguages();
  const tones = toneOptions();
  const styles = styleOptions();

  // The original text to translate from (used to re-translate; not displayed).
  const source = metaString(toolResult.meta, "source");
  const saved = toolResult.content as TranslateState | undefined;

  const [targetLang, setTargetLang] = useState(() => saved?.language || "en");
  const [tone, setTone] = useState(() => saved?.tone ?? "");
  const [style, setStyle] = useState(() => saved?.style ?? "");
  // Translation lives on `content`; fall back to `result` for chats created before
  // the result became a status line.
  const [currentText, setCurrentText] = useState(() => saved?.text ?? resultText(toolResult));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rewrite popover state
  const [rewriteMenu, setRewriteMenu] = useState<{
    selectedText: string;
    selectionStart: number;
    selectionEnd: number;
    position: { x: number; y: number };
  } | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const lastSelectionRef = useRef<string>("");

  const selectedLanguage = languages.find((l) => l.code === targetLang);

  // Write the edit onto the tool result's `content` (translation + selected
  // controls). `content` is never sent to the model, so edits never re-enter its
  // context; only the inline widget reads it. preserveDates keeps these background
  // saves from reordering the chat list.
  const persist = useCallback(
    (next: TranslateState) => {
      if (!chat) return;
      updateChat(
        chat.id,
        (c) => ({
          messages: c.messages.map((m, i) =>
            i === index
              ? {
                  ...m,
                  content: m.content.map((part) =>
                    part.type === "tool_result" && part.id === toolResult.id
                      ? { ...part, content: { ...part.content, ...next } }
                      : part,
                  ),
                }
              : m,
          ),
        }),
        { preserveDates: true },
      );
    },
    [chat, updateChat, index, toolResult.id],
  );

  // Re-translate from the original source whenever a control changes.
  const retranslate = useCallback(
    async (language: string, toneValue: string, styleValue: string) => {
      if (!source.trim()) return;
      setIsLoading(true);
      setError(null);
      try {
        const text = await translateText(client, {
          lang: language,
          text: source,
          tone: toneValue,
          style: styleValue,
          model,
        });
        setCurrentText(text);
        persist({ language, tone: toneValue, style: styleValue, text });
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unknown error occurred during translation.");
      } finally {
        setIsLoading(false);
      }
    },
    [client, source, model, persist],
  );

  const handleTextSelect = useCallback(
    (selectedText: string, position: { x: number; y: number }, positionStart: number, positionEnd: number) => {
      if (!selectedText.trim()) return;
      const selectionKey = `${selectedText}-${positionStart}-${positionEnd}`;
      if (lastSelectionRef.current === selectionKey) return;
      lastSelectionRef.current = selectionKey;
      setRewriteMenu(null);
      setTimeout(() => {
        setRewriteMenu({
          selectedText: selectedText.trim(),
          selectionStart: positionStart,
          selectionEnd: positionEnd,
          position,
        });
      }, 50);
    },
    [],
  );

  const handleSelect = (alternative: string, contextToReplace: string) => {
    if (currentText) {
      const next = currentText.replace(contextToReplace, alternative);
      setCurrentText(next);
      persist({ language: targetLang, tone, style, text: next });
    }
    setRewriteMenu(null);
  };

  const closeRewriteMenu = () => {
    setRewriteMenu(null);
    setPreviewText(null);
    lastSelectionRef.current = "";
  };

  return (
    <div className="mt-2 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-900/40">
      {/* Target controls */}
      <div className="flex items-center gap-1 px-3 pt-2 flex-wrap">
        <SelectorMenu
          icon={<GlobeIcon size={14} className="-ml-0.5" />}
          label={selectedLanguage?.name || "Select Language"}
          options={languages.map((l) => ({ value: l.code, label: l.name }))}
          onSelect={(lang) => {
            setTargetLang(lang);
            retranslate(lang, tone, style);
          }}
          scrollable
        />
        <SelectorMenu
          icon={<ThermometerIcon size={14} />}
          label={tone ? (tones.find((t) => t.value === tone)?.label ?? "Tone") : "Tone"}
          options={tones}
          onSelect={(value) => {
            setTone(value);
            retranslate(targetLang, value, style);
          }}
        />
        <SelectorMenu
          icon={<SwatchBookIcon size={14} />}
          label={style ? (styles.find((s) => s.value === style)?.label ?? "Style") : "Style"}
          options={styles}
          onSelect={(value) => {
            setStyle(value);
            retranslate(targetLang, tone, value);
          }}
        />
        <div className="ml-auto flex items-center gap-1 pr-1">
          {isLoading && <Loader2 size={14} className="animate-spin text-neutral-400" />}
          {currentText && <CopyButton text={currentText} className="h-4 w-4" />}
        </div>
      </div>

      {/* Target text */}
      <InteractiveText
        text={currentText}
        placeholder="Translation will appear here"
        className="px-3 pt-1.5 pb-3 text-sm text-neutral-800 dark:text-neutral-200"
        onTextSelect={handleTextSelect}
        previewText={previewText}
      />

      {error && <div className="px-3 pb-3 text-xs text-red-600 dark:text-red-400">{error}</div>}

      {rewriteMenu && currentText && (
        <RewritePopover
          selectedText={rewriteMenu.selectedText}
          fullText={currentText}
          selectionStart={rewriteMenu.selectionStart}
          selectionEnd={rewriteMenu.selectionEnd}
          position={rewriteMenu.position}
          onClose={closeRewriteMenu}
          onSelect={handleSelect}
          onPreview={setPreviewText}
        />
      )}
    </div>
  );
}
