import { FileSystemManager } from "@/features/artifacts/lib/fs";
import * as opfs from "@/shared/lib/opfs";
import type { Chat, Content, Message } from "@/shared/types/chat";
import { Role, withMessageIdentity } from "@/shared/types/chat";
import type { NotebookOutput } from "../types/notebook";
import { getMessages, getNotebook, getOutputs, getSources } from "./opfs-notebook";

interface NotebookConversionMarker {
  version: 1;
  notebookId: string;
  chatId: string;
  status: "partial" | "complete";
  artifactRevisions: Record<string, string>;
  updatedAt: string;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "notebook"
  );
}

function compatibleContent(content: Content[]): Content[] {
  return content.filter(
    (part) => part.type !== "tool_call" && part.type !== "tool_result" && part.type !== "runtime_feedback",
  );
}

function outputDirectory(root: string, output: NotebookOutput): string {
  return `${root}/outputs/${slug(output.title)}-${output.id.slice(0, 8)}`;
}

async function materializeOutput(fs: FileSystemManager, root: string, output: NotebookOutput): Promise<string[]> {
  const directory = outputDirectory(root, output);
  const primaryPaths: string[] = [];

  if (output.type === "report") {
    const path = `${directory}/report.md`;
    await fs.createFile(path, output.content || `# ${output.title}\n`, "text/markdown");
    primaryPaths.push(path);
  } else if (output.type === "infographic" && output.imageUrl) {
    const path = `${directory}/infographic.png`;
    await fs.createFile(path, output.imageUrl, "image/png");
    primaryPaths.push(path);
    if (output.content) await fs.createFile(`${directory}/notes.md`, output.content, "text/markdown");
  } else if (output.type === "podcast") {
    if (output.audioUrl) {
      const path = `${directory}/audio.wav`;
      await fs.createFile(path, output.audioUrl, "audio/wav");
      primaryPaths.push(path);
    }
    if (output.content) await fs.createFile(`${directory}/script.md`, output.content, "text/markdown");
  } else if (output.type === "quiz") {
    const path = `${directory}/quiz.json`;
    await fs.createFile(path, JSON.stringify(output.quiz ?? [], null, 2), "application/json");
    primaryPaths.push(path);
  } else if (output.type === "mindmap") {
    const path = `${directory}/mindmap.json`;
    await fs.createFile(path, JSON.stringify(output.mindMap ?? {}, null, 2), "application/json");
    primaryPaths.push(path);
  } else if (output.type === "slides") {
    const extension = output.slideContentType === "text/html" ? "html" : "png";
    const slidePaths: string[] = [];
    for (let index = 0; index < (output.slides?.length ?? 0); index++) {
      const payload = output.slides?.[index];
      if (!payload) continue;
      const path = `${directory}/slides/${String(index + 1).padStart(3, "0")}.${extension}`;
      await fs.createFile(path, payload, output.slideContentType ?? "image/png");
      slidePaths.push(path);
    }
    const indexPath = `${directory}/slides.md`;
    const indexBody = [
      `# ${output.title}`,
      "",
      ...Array.from({ length: output.slides?.length ?? 0 }, (_, index) => {
        const path = `${directory}/slides/${String(index + 1).padStart(3, "0")}.${extension}`;
        return slidePaths.includes(path) ? `${index + 1}. ${path}` : `${index + 1}. **Missing slide**`;
      }),
    ].join("\n");
    await fs.createFile(indexPath, indexBody, "text/markdown");
    primaryPaths.push(indexPath);
    if (output.content) await fs.createFile(`${directory}/plan.md`, output.content, "text/markdown");
  }

  if (primaryPaths.length === 0 && output.content) {
    const path = `${directory}/output.md`;
    await fs.createFile(path, output.content, "text/markdown");
    primaryPaths.push(path);
  }
  return primaryPaths;
}

/** Idempotently materialize a legacy Notebook as one chat plus standard artifacts. */
export async function convertNotebookToChat(notebookId: string): Promise<string> {
  const notebook = await getNotebook(notebookId);
  if (!notebook) throw new Error(`Notebook not found: ${notebookId}`);

  const markerPath = `notebooks/${notebookId}/chat-conversion.json`;
  const prior = await opfs.readJson<NotebookConversionMarker>(markerPath);
  const chatId = prior?.chatId ?? crypto.randomUUID();
  const marker: NotebookConversionMarker = {
    version: 1,
    notebookId,
    chatId,
    status: "partial",
    artifactRevisions: prior?.artifactRevisions ?? {},
    updatedAt: new Date().toISOString(),
  };
  await opfs.writeJson(markerPath, marker);

  const fs = new FileSystemManager(chatId);
  const root = `/imports/${slug(notebook.customTitle ?? notebook.title)}`;
  const [sources, outputs, notebookMessages] = await Promise.all([
    getSources(notebookId),
    getOutputs(notebookId),
    getMessages(notebookId),
  ]);

  for (const source of sources) {
    await fs.createFile(`${root}/sources/${source.path}`, source.content, source.contentType);
  }

  const primaryPaths: string[] = [];
  for (const output of outputs) primaryPaths.push(...(await materializeOutput(fs, root, output)));

  const messages: Message[] = notebookMessages.flatMap((message, index) => {
    const content = compatibleContent(message.content);
    if (content.length === 0) return [];
    return [
      withMessageIdentity({
        ...message,
        id: message.id ?? `notebook-${notebookId}-${index}`,
        createdAt: message.createdAt ?? message.timestamp,
        content,
      }),
    ];
  });
  if (primaryPaths.length > 0 || sources.length > 0) {
    messages.push(
      withMessageIdentity({
        id: `notebook-${notebookId}-conversion`,
        role: Role.Assistant,
        createdAt: notebook.updatedAt,
        content: [
          {
            type: "text",
            text: `Converted the legacy Notebook into this chat. Preserved ${sources.length} source(s) and ${outputs.length} output(s) under ${root}.`,
          },
          ...primaryPaths.map((path) => ({
            type: "artifact_ref" as const,
            path,
            displayName: path.split("/").pop() ?? path,
          })),
        ],
      }),
    );
  }

  const chat: Chat = {
    id: chatId,
    title: notebook.title,
    customTitle: notebook.customTitle,
    created: new Date(notebook.createdAt),
    updated: new Date(notebook.updatedAt),
    model: null,
    messages,
  };
  const stored = await opfs.extractChatBlobs(chat);
  await opfs.writeJson(`chats/${chatId}/chat.json`, stored);
  await opfs.upsertIndexEntry("chats", {
    id: chatId,
    title: chat.title,
    customTitle: chat.customTitle,
    created: notebook.createdAt,
    updated: notebook.updatedAt,
  });
  await opfs.deleteUnreferencedChatBlobs(stored);

  const entries = await fs.listEntries();
  marker.artifactRevisions = Object.fromEntries(
    await Promise.all(entries.map(async (entry) => [entry.path, (await fs.getRevision(entry.path)) ?? ""] as const)),
  );
  marker.status = "complete";
  marker.updatedAt = new Date().toISOString();
  await opfs.writeJson(markerPath, marker);
  return chatId;
}
