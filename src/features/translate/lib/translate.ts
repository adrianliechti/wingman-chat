import type { Client } from "@/shared/lib/client";

export interface TranslateTextOptions {
  lang: string;
  text: string;
  tone?: string;
  style?: string;
  model?: string;
}

/**
 * Translate `text` into `lang`, then optionally re-cast it for tone/style.
 * Shared by the Translate page and the in-chat translate tool so the
 * translate-then-rewrite sequence lives in one place.
 */
export async function translateText(
  client: Client,
  { lang, text, tone, style, model }: TranslateTextOptions,
): Promise<string> {
  const result = await client.translate(lang, text);
  if (typeof result !== "string") {
    throw new Error("Expected a text translation but received a file.");
  }

  if (tone || style) {
    return client.rewriteText(model ?? "", result, lang, tone, style);
  }
  return result;
}
