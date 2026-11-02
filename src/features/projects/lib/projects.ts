import type { FileEntry } from "@/shared/types/file";

export interface ProjectFile extends FileEntry {
  id: string;
  name: string;
  source?: { chatId: string; path: string; revision?: string };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  created: string;
  updated: string;
  files: ProjectFile[];
}

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const p = value as Project;
  const safeId = (id: unknown) => typeof id === "string" && !!id && !/[/\\\0]/.test(id) && id !== "." && id !== "..";
  return (
    safeId(p.id) &&
    typeof p.name === "string" &&
    !!p.name.trim() &&
    typeof p.description === "string" &&
    typeof p.instructions === "string" &&
    typeof p.created === "string" &&
    typeof p.updated === "string" &&
    Array.isArray(p.files) &&
    p.files.every(
      (file) =>
        !!file &&
        typeof file === "object" &&
        safeId(file.id) &&
        typeof file.name === "string" &&
        !!file.name &&
        file.path === `/${file.name}` &&
        !/[/\\\0]/.test(file.name) &&
        file.name !== "." &&
        file.name !== ".." &&
        typeof file.size === "number" &&
        Number.isFinite(file.size) &&
        file.size >= 0 &&
        (file.contentType === undefined || typeof file.contentType === "string"),
    )
  );
}

export function projectFileName(name: string, files: readonly ProjectFile[]): string {
  const base = name.split(/[/\\]/).at(-1)?.trim();
  if (!base || base === "." || base === ".." || base.includes("\0")) throw new Error("Invalid file name");
  const used = new Set(files.map((file) => file.name.toLowerCase()));
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}
