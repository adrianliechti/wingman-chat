import { Languages } from "lucide-react";
import { useCallback, useMemo } from "react";
import { getConfig } from "@/shared/config";
import type { TextContent, Tool, ToolContext, ToolProvider } from "@/shared/types/chat";
import { styleOptions, supportedLanguages, toneOptions } from "../context/TranslateContext";
import { translateText } from "../lib/translate";

function errorResult(error: string): TextContent[] {
  return [{ type: "text", text: JSON.stringify({ success: false, error }) }];
}

export function useTranslateProvider(): ToolProvider | null {
  const config = getConfig();
  const isAvailable = !!config.translator;
  const client = config.client;

  const translateTools = useCallback((): Tool[] => {
    const languages = supportedLanguages();
    const tones = toneOptions()
      .map((t) => t.value)
      .filter(Boolean);
    const styles = styleOptions()
      .map((s) => s.value)
      .filter(Boolean);
    const defaultLang = config.translator?.languages[0] ?? "en";
    const maxTextLength = config.translator?.maxTextLength;
    const model = config.translator?.model;

    return [
      {
        name: "translate",
        title: "Translate",
        description:
          "Translate text into another language and open an interactive translation panel inline. The user can refine the target language, tone, and style afterward, so pass their text through faithfully.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to translate, in the user's own words.",
            },
            language: {
              type: "string",
              description: `Target language code. One of: ${languages.map((l) => `${l.code} (${l.name})`).join(", ")}. Defaults to ${defaultLang}.`,
            },
            tone: {
              type: "string",
              enum: tones,
              description: "Optional tone to apply to the translation.",
            },
            style: {
              type: "string",
              enum: styles,
              description: "Optional writing style to apply to the translation.",
            },
          },
          required: ["text"],
        },
        function: async (args: Record<string, unknown>, context?: ToolContext) => {
          const text = typeof args.text === "string" ? args.text.trim() : "";
          if (!text) return errorResult("`text` is required.");

          const requested = typeof args.language === "string" ? args.language.trim() : "";
          const lang = languages.some((l) => l.code === requested) ? requested : defaultLang;
          const tone = typeof args.tone === "string" ? args.tone : "";
          const style = typeof args.style === "string" ? args.style : "";

          if (maxTextLength != null && text.length > maxTextLength) {
            return errorResult(
              `Text is ${text.length.toLocaleString()} characters, over the ${maxTextLength.toLocaleString()} limit.`,
            );
          }

          try {
            const translated = await translateText(client, { lang, text, tone, style, model });
            const languageName = languages.find((l) => l.code === lang)?.name ?? lang;
            // `meta` drives the inline widget; `content` holds the (editable)
            // translation. Neither is sent to the model — only `result` is — so
            // the result is a status line, not the translation, to keep the model
            // from echoing what the user can already see and edit in the panel.
            context?.setMeta?.({ toolComponent: "translate", source: text });
            context?.setContent?.({ language: lang, tone, style, text: translated });
            return [
              {
                type: "text" as const,
                text: `Translated to ${languageName} and shown to the user in an interactive panel they can edit. Do not repeat the translation in your reply.`,
              },
            ];
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return errorResult(`Translation failed: ${message}`);
          }
        },
      },
    ];
  }, [client, config.translator?.languages, config.translator?.maxTextLength, config.translator?.model]);

  return useMemo<ToolProvider | null>(() => {
    if (!isAvailable) return null;
    return {
      id: "translate",
      name: "Translate",
      description: "Translate text inline",
      icon: Languages,
      tools: translateTools(),
    };
  }, [isAvailable, translateTools]);
}
