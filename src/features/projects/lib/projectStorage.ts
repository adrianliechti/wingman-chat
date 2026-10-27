import {
  readIndex,
  readJson,
  writeJson,
  writeBlob,
  readBlob,
  deleteDirectory,
  upsertIndexEntry,
  removeIndexEntry,
  blobToDataUrl,
} from "@/shared/lib/opfs-core";
import { withPersistenceLock } from "@/shared/lib/persistence";
import { isTextContentType } from "@/shared/lib/fileTypes";
import type { File as WorkspaceFile } from "@/shared/types/file";
import { isProject, projectFileName, type Project, type ProjectFile } from "./projects";

function projectPath(id: string): string {
  if (!id || /[/\\\0]/.test(id) || id === "." || id === "..") throw new Error("Invalid project id");
  return `projects/${id}`;
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const value = await readJson<unknown>(`${projectPath(id)}/project.json`);
  if (value === undefined) return undefined;
  if (!isProject(value) || value.id !== id) throw new Error("Invalid saved project");
  return value;
}

async function writeProject(project: Project): Promise<void> {
  await writeJson(`${projectPath(project.id)}/project.json`, project);
  await upsertIndexEntry("projects", {
    id: project.id,
    title: project.name,
    created: project.created,
    updated: project.updated,
  });
}

export const projectStorage = {
  load: async () => {
    const projects: Project[] = [];
    for (const entry of await readIndex("projects")) {
      const project = await loadProject(entry.id);
      if (project) projects.push(project);
    }
    return projects;
  },
  store: (project: Project) => withPersistenceLock("collection:projects", () => writeProject(project)),
  remove: (id: string) =>
    withPersistenceLock("collection:projects", async () => {
      await deleteDirectory(projectPath(id));
      await removeIndexEntry("projects", id);
    }),
};

/** The immutable file is durable before its metadata can refer to it. */
export async function saveProjectFile(
  project: Project,
  file: File,
  source?: ProjectFile["source"],
): Promise<ProjectFile> {
  const id = crypto.randomUUID();
  const name = projectFileName(file.name, project.files);
  await withPersistenceLock("collection:projects", async () => {
    if (!(await loadProject(project.id))) throw new Error("This project was deleted");
    await writeBlob(`${projectPath(project.id)}/files/${id}`, file);
  });
  return {
    id,
    name,
    path: `/${name}`,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    lastModified: file.lastModified,
    source,
  };
}

export async function readProjectFile(project: Project, path: string): Promise<WorkspaceFile | undefined> {
  const file = project.files.find((file) => file.path === path);
  if (!file) return undefined;
  const blob = await readBlob(`${projectPath(project.id)}/files/${file.id}`);
  if (!blob) throw new Error(`Project file is missing: ${file.name}`);
  return {
    path,
    contentType: file.contentType,
    content: isTextContentType(file.contentType ?? "")
      ? await blob.text()
      : await blobToDataUrl(blob, file.contentType),
  };
}
