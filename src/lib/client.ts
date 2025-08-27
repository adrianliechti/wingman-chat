import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import mime from "mime";

import { Role, AttachmentType } from "../types/chat";
import type { Tool } from "../types/chat";
import type { Message, Model } from "../types/chat";
import type { SearchResult } from "../types/search";

export class Client {
  private oai: OpenAI;

  constructor(apiKey: string = "sk-") {
    this.oai = new OpenAI({
      baseURL: new URL("/api/v1", window.location.origin).toString(),
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  async listModels(): Promise<Model[]> {
    const models = await this.oai.models.list();
    return models.data.map((model) => ({
      id: model.id,
      name: model.id,
    }));
  }

  async complete(
    model: string, 
    instructions: string, 
    input: Message[], 
    tools: Tool[], 
    handler?: (delta: string, snapshot: string) => void
  ): Promise<Message> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (instructions) {
      messages.push({
        role: "system",
        content: [{ type: "text", text: instructions }],
      });
    }

    for (const m of input) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];

      if (m.content) {
        content.push({ type: "text", text: m.content });
      }

      for (const a of m.attachments ?? []) {
        if (a.type === AttachmentType.Text) {
          content.push({
            type: "text",
            text: "````text\n// " + a.name + "\n" + a.data + "\n````",
          });
        }

        if (a.type === AttachmentType.File) {
          content.push({
            type: "file",
            file: { file_data: a.data },
          });
        }

        if (a.type === AttachmentType.Image) {
          content.push({
            type: "image_url",
            image_url: { url: a.data },
          });
        }
      }

      switch (m.role) {
        case Role.User: {
          messages.push({
            role: Role.User,
            content: content,
          });
          break;
        }

        case Role.Assistant: {
          const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = {
            role: Role.Assistant,
            content: content.filter((c) => c.type === "text"),
          };
          
          // Add tool calls if they exist
          if (m.toolCalls && m.toolCalls.length > 0) {
            assistantMessage.tool_calls = m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            }));
          }
          
          messages.push(assistantMessage);
          break;
        }

        case Role.Tool: {
          // Handle tool messages if they exist in input
          if (m.toolResult) {
            messages.push({
              role: "tool",
              content: m.content,
              tool_call_id: m.toolResult.id,
            });
          }
          break;
        }
      }
    }

    const stream = this.oai.chat.completions.stream({
      model: model,
      tools: this.toTools(tools),
      messages: messages,
      stream: true,
      stream_options: { include_usage: true },
    });

    if (handler) {
      stream.on("content", handler);
    }

    const completion = await stream.finalChatCompletion() as OpenAI.ChatCompletion;
    
    const message = completion.choices[0].message;

    // Check if the response was refused by the model
    if (message.refusal) {
      return {
        role: Role.Assistant,
        content: "",
        error: {
          code: "CONTENT_REFUSAL",
          message: message.refusal
        }
      };
    }

    return {
      role: Role.Assistant,
      content: message.content ?? "",
      toolCalls: message.tool_calls?.filter(tc => tc.type === 'function').map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    };
  }

  async summarize(model: string, input: Message[]): Promise<string> {
    const history = input
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\\n");

    const completion = await this.oai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: `Summarize the following conversation into a short title (less than 10 words). Return only the title itself, without any introductory phrases, explanations, or quotation marks.\n\nConversation:\n${history}`,
        },
      ]
    });

    return completion.choices[0].message.content?.trim() ?? "Summary not available";
  }

  async relatedPrompts(model: string, prompt: string): Promise<string[]> {
    const Schema = z.object({
      prompts: z.array(z.object({
        prompt: z.string(),
      }).strict()).min(3).max(10),
    }).strict();

    if (!prompt) {
      prompt = "No conversation history provided. Please suggest interesting prompts to start a new conversation.";
    }

    try {
      const completion = await this.oai.chat.completions.parse({
        model: model,
        messages: [
          {
            role: "system",
            content: `Based on the conversation history provided, generate 3-5 related follow-up prompts that would help the user explore the topic more deeply. The prompts should be:

- From the user's point of view 
- Specific and actionable
- Build upon the current conversation context
- Encourage deeper exploration or different perspectives
- Be concise but clear (maximal 15 words each)
- Vary in type (clarifying questions, requests for examples, deeper analysis, practical applications, etc.)

Return only the prompts themselves, without numbering or bullet points.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: zodResponseFormat(Schema, "list_prompts"),
      });

      const list = completion.choices[0].message.parsed;
      return list?.prompts.map((p) => p.prompt) ?? [];
    } catch (error) {
      console.error("Error generating related prompts:", error);
      return [];
    }
  }

  async rewriteSelection(model: string, text: string, selectionStart: number, selectionEnd: number): Promise<{ alternatives: string[], contextToReplace: string, keyChanges: string[] }> {
    const Schema = z.object({
      alternatives: z.array(z.object({
        text: z.string(),
        keyChange: z.string(),
      }).strict()).min(3).max(6),
    }).strict();

    if (!text.trim() || selectionStart < 0 || selectionEnd <= selectionStart || selectionStart >= text.length) {
      return { alternatives: [], contextToReplace: text.substring(selectionStart, selectionEnd), keyChanges: [] };
    }

    // Helper function to split text into sentences
    const splitSentences = (text: string): { text: string, start: number, end: number }[] => {
      const sentences: { text: string, start: number, end: number }[] = [];
      const sentencePattern = /[.!?]+\s*|\n+/g;
      let lastIndex = 0;
      let match;

      while ((match = sentencePattern.exec(text)) !== null) {
        const sentenceText = text.substring(lastIndex, match.index + match[0].length).trim();
        if (sentenceText) {
          sentences.push({
            text: sentenceText,
            start: lastIndex,
            end: match.index + match[0].length
          });
        }
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text as final sentence if any
      if (lastIndex < text.length) {
        const sentenceText = text.substring(lastIndex).trim();
        if (sentenceText) {
          sentences.push({
            text: sentenceText,
            start: lastIndex,
            end: text.length
          });
        }
      }

      return sentences;
    };

    // Helper function to find sentences that overlap with the selection
    const findSentencesInSelection = (sentences: { text: string, start: number, end: number }[], selectionStart: number, selectionEnd: number): string => {
      const overlappingSentences = sentences.filter(sentence => 
        // Sentence overlaps if it starts before selection ends and ends after selection starts
        sentence.start < selectionEnd && sentence.end > selectionStart
      );

      if (overlappingSentences.length === 0) {
        // Fallback to the selection itself
        return text.substring(selectionStart, selectionEnd).trim();
      }

      // Combine all overlapping sentences
      const firstSentence = overlappingSentences[0];
      const lastSentence = overlappingSentences[overlappingSentences.length - 1];
      
      return text.substring(firstSentence.start, lastSentence.end).trim();
    };

    const sentences = splitSentences(text);
    const contextToRewrite = findSentencesInSelection(sentences, selectionStart, selectionEnd);
    const selectedText = text.substring(selectionStart, selectionEnd);

    try {
      const completion = await this.oai.chat.completions.parse({
        model: model,
        messages: [
          {
            role: "system",
            content: `You will be given text that contains a user's selection. Your task is to rewrite the complete sentence(s) containing that selection while maintaining the same meaning.

Guidelines:
- Rewrite the complete sentence(s) that contain the selected text
- Keep the core meaning intact but offer stylistic variations
- Ensure the rewritten sentences are natural and grammatically correct
- Maintain the same language, tone, and formality level
- Focus on varying the expression while preserving the intent
- Each alternative should be complete, standalone sentence(s)

For each alternative, also provide a "keyChange" that shows only the significant difference compared to the original selected text. This should be:
- Just the key word(s) or phrase that changes the meaning/style
- Not the complete sentence, just the replacement part
- What the user would see as the main change

Return 3-6 alternative rewritten versions with their key changes.`,
          },
          {
            role: "user",
            content: `Text to rewrite: "${contextToRewrite}"

Selected text within: "${selectedText}"

Please provide alternative ways to rewrite this text. For each alternative, include both the complete rewritten text and the key change that represents the main difference from the original selected text.`,
          },
        ],
        response_format: zodResponseFormat(Schema, "rewrite_selection"),
      });

      const result = completion.choices[0].message.parsed;
      return {
        alternatives: result?.alternatives.map((a) => a.text) ?? [],
        contextToReplace: contextToRewrite,
        keyChanges: result?.alternatives.map((a) => a.keyChange) ?? []
      };
    } catch (error) {
      console.error("Error generating text alternatives:", error);
      return { alternatives: [], contextToReplace: contextToRewrite, keyChanges: [] };
    }
  }

  async extractText(blob: Blob): Promise<string> {
    const data = new FormData();
    data.append("file", blob);
    data.append("format", "text");

    const resp = await fetch(new URL("/api/v1/extract", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Extract request failed with status ${resp.status}`);
    }

    return resp.text();
  }

  async fetchText(url: string): Promise<string> {
    const data = new FormData();
    data.append("url", url);
    data.append("format", "text");

    const resp = await fetch(new URL("/api/v1/extract", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Fetch request failed with status ${resp.status}`);
    }

    return resp.text();
  }

  async segmentText(blob: Blob): Promise<string[]> {
    const data = new FormData();
    data.append("file", blob);

    const resp = await fetch(new URL("/api/v1/segment", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Segment request failed with status ${resp.status}`);
    }

    const result = await resp.json();
    
    if (!Array.isArray(result)) {
       return [];
    }
      
    return result.map((item: { text?: string } | string) => {
        if (typeof item === 'string') return item;
        return item.text || '';
      });
  }

  async embedText(model: string, text: string): Promise<number[]> {
    const embedding = await this.oai.embeddings.create({
      model: model,
      input: text,
      encoding_format: "float",
    });

    return embedding.data[0].embedding;
  }

  async translate(lang: string, input: string | Blob): Promise<string | Blob> {
    // Input validation
    if (input instanceof Blob) {
      // Check file size limit (10MB)
      const maxFileSize = 10 * 1024 * 1024; // 10MB in bytes
      if (input.size > maxFileSize) {
        throw new Error(`File size ${(input.size / 1024 / 1024).toFixed(1)}MB exceeds the maximum limit of 10MB`);
      }
    } else {
      // Check text length limit (50,000 characters)
      const maxTextLength = 50000;
      if (input.length > maxTextLength) {
        throw new Error(`Text length ${input.length.toLocaleString()} characters exceeds the maximum limit of ${maxTextLength.toLocaleString()} characters`);
      }
    }

    const data = new FormData();
    data.append("lang", lang);
    
    const headers: HeadersInit = {};
    
    if (input instanceof Blob) {
      data.append("file", input);
      headers["Accept"] = input.type || "application/octet-stream";
    } else {
      data.append("text", input);
    }

    const resp = await fetch(new URL("/api/v1/translate", window.location.origin), {
      method: "POST",
      headers,
      body: data,
    });

    if (!resp.ok) {
      throw new Error(`Translate request failed with status ${resp.status}`);
    }

    const contentType = resp.headers.get("content-type")?.toLowerCase() || "";
    
    if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
      const translatedText = await resp.text();
      // Replace German ß with ss automatically
      return translatedText.replace(/ß/g, 'ss');
    }
    
    return resp.blob();
  }

  async rewriteText(model: string, text: string, lang: string, tone: string = '', style: string = ''): Promise<string> {
    const Schema = z.object({
      rewrittenText: z.string(),
    }).strict();

    if (!text.trim()) {
      return text;
    }

    // Build tone instruction
    const toneInstruction = !tone ? '' : 
      tone === 'enthusiastic' ? 'Use an enthusiastic and energetic tone.' :
      tone === 'friendly' ? 'Use a warm and friendly tone.' :
      tone === 'confident' ? 'Use a confident and assertive tone.' :
      tone === 'diplomatic' ? 'Use a diplomatic and tactful tone.' :
      '';

    // Build style instruction
    const styleInstruction = !style ? '' :
      style === 'simple' ? 'Use simple and clear language.' :
      style === 'business' ? 'Use professional business language.' :
      style === 'academic' ? 'Use formal academic language.' :
      style === 'casual' ? 'Use casual and informal language.' :
      '';

    // Combine instructions
    const additionalInstructions = [toneInstruction, styleInstruction].filter(Boolean).join(' ');

    try {
      const completion = await this.oai.chat.completions.parse({
        model: model,
        messages: [
          {
            role: "system",
            content: `You are a text rewriting assistant. Your task is to rewrite the given text while maintaining its core meaning and translating it to the target language if needed.

Guidelines:
- Translate the text to ${lang} if it's not already in that language
- Maintain the core meaning and information
- ${additionalInstructions || 'Keep the original tone and style'}
- Ensure the output is natural and fluent
- For German text: Use "ss" instead of "ß" (eszett) for better compatibility
- Return only the rewritten text without any explanations`,
          },
          {
            role: "user",
            content: `Please rewrite this text: "${text}"`,
          },
        ],
        response_format: zodResponseFormat(Schema, "rewrite_text"),
      });

      const result = completion.choices[0].message.parsed;
      let rewrittenText = result?.rewrittenText ?? text;
      
      // Replace German ß with ss automatically
      rewrittenText = rewrittenText.replace(/ß/g, 'ss');
      
      return rewrittenText;
    } catch (error) {
      console.error("Error rewriting text:", error);
      return text;
    }
  }

  async speakText(model: string, input: string, voice?: string): Promise<void> {
    if (!input.trim()) {
      return;
    }

    const response = await this.oai.audio.speech.create({
      model: model,
      input: input,

      instructions: "Speak in a clear and natural tone.",

      voice: voice ?? "",
      response_format: "wav",
    });

    const audioBuffer = await response.arrayBuffer();      
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const audio = new Audio(audioUrl);
    
    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      
      audio.onerror = (error) => {
        URL.revokeObjectURL(audioUrl);
        reject(new Error(`Audio playback failed: ${error}`));
      };
      
      audio.play().catch(reject);
    });
  }

  async transcribe(model: string, blob: Blob): Promise<string> {
    const data = new FormData();
    
    // Get file extension using mime package
    const extension = mime.getExtension(blob.type) || 'audio';
    const filename = `audio_recording.${extension}`;
    
    data.append('file', blob, filename);

    if(model) {
      data.append('model', model);
    }

    const response = await fetch(new URL("/api/v1/audio/transcriptions", window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Transcription request failed with status ${response.status}`);
    }

    const result = await response.json();
    return result.text || '';
  }

  async search(query: string): Promise<SearchResult[]> {
    const data = new FormData();
    data.append('query', query);

    const response = await fetch(new URL(`/api/v1/retrieve`, window.location.origin), {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    const results = await response.json();
    
    if (!Array.isArray(results)) {
      return [];
    }

    return results.map((result: SearchResult) => ({
      title: result.title || undefined,
      source: result.source || undefined,
      content: result.content,
    }));
  }

  async generateImage(
    model: string,
    prompt: string,
    images?: Blob[]
  ): Promise<Blob> {
    try {
      const data = new FormData();
      data.append('input', prompt);

      if (model) {
        data.append('model', model);
      }

      // Add optional image blobs as files
      if (images && images.length > 0) {
        images.forEach((blob, index) => {
          const extension = mime.getExtension(blob.type) || 'image';
          const filename = `image_${index}.${extension}`;

          data.append('file', blob, filename);
        });
      }

      const response = await fetch(new URL(`/api/v1/render`, window.location.origin), {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        throw new Error(`Image generation request failed with status ${response.status}`);
      }

      return response.blob();
    } catch (error) {
      console.error("Image generation failed:", error);
      throw error;
    }
  }

  private toTools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,

        strict: true,
        parameters: tool.parameters,
      },
    }));
  }
}