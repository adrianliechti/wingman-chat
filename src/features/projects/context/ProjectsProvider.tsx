import { useCallback, useState, type ReactNode } from "react";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import { getConfig } from "@/shared/config";
import { withPersistenceLock } from "@/shared/lib/persistence";
import { deleteProjectFile, projectStorage, saveProjectFile } from "../lib/projectStorage";
import type { Project, ProjectFile } from "../lib/projects";
import { ProjectsContext } from "./ProjectsContext";

const PROJECT_STORAGE_KEY = "app_project";

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [editingProjectId, editProject] = useState<string | null>(null);
  const {
    items: projects,
    isLoaded,
    create,
    update,
    remove,
    getItems,
    flush,
  } = usePersistentCollection(projectStorage);
  const [storedProjectId, setStoredProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PROJECT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  // Selection stores identity only; a project deleted elsewhere falls back to All chats.
  const selectedProjectId = projects.some((p) => p.id === storedProjectId) ? storedProjectId : null;
  const selectProject = useCallback((id: string | null) => {
    setStoredProjectId(id);
    try {
      if (id) localStorage.setItem(PROJECT_STORAGE_KEY, id);
      else localStorage.removeItem(PROJECT_STORAGE_KEY);
    } catch (error) {
      console.warn("Could not save project selection:", error);
    }
  }, []);
  const createProject = useCallback(
    async (name: string) => {
      if (!name.trim()) throw new Error("Give the project a name");
      const now = new Date().toISOString();
      return create({
        id: crypto.randomUUID(),
        name: name.trim(),
        description: "",
        instructions: "",
        created: now,
        updated: now,
        files: [],
      });
    },
    [create],
  );
  const updateProject = useCallback(
    async (id: string, changes: Partial<Pick<Project, "name" | "description" | "instructions">>) => {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error("Give the project a name");
      update(id, (p) => ({ ...p, ...changes, updated: new Date().toISOString() }));
      await flush(id);
    },
    [update, flush],
  );
  const deleteProject = useCallback(
    async (id: string) => {
      await remove(id);
      if (selectedProjectId === id) selectProject(null);
    },
    [remove, selectedProjectId, selectProject],
  );
  const addFile = useCallback(
    async (id: string, file: File, source?: ProjectFile["source"]) => {
      const maxSize = getConfig().artifacts?.maxFileSize ?? 100 * 1024 * 1024;
      if (file.size > maxSize) throw new Error(`File exceeds the ${Math.floor(maxSize / 1024 / 1024)} MB limit`);
      await withPersistenceLock(`project-upload:${id}`, async () => {
        const project = getItems().find((p) => p.id === id);
        if (!project) throw new Error("This project was deleted");
        await flush(id);
        const typed = file.type
          ? file
          : new File([file], file.name, { type: inferContentTypeFromPath(file.name) ?? "application/octet-stream" });
        const entry = await saveProjectFile(project, typed, source);
        if (!getItems().some((p) => p.id === id)) throw new Error("This project was deleted");
        update(id, (p) => ({ ...p, files: [...p.files, entry], updated: new Date().toISOString() }));
        await flush(id);
      });
    },
    [getItems, flush, update],
  );
  const removeFile = useCallback(
    async (id: string, fileId: string) => {
      update(id, (p) => ({ ...p, files: p.files.filter((f) => f.id !== fileId), updated: new Date().toISOString() }));
      await flush(id);
      try {
        await deleteProjectFile(id, fileId);
      } catch (error) {
        console.warn("Project file cleanup failed:", error);
      }
    },
    [update, flush],
  );
  return (
    <ProjectsContext
      value={{
        projects,
        isLoaded,
        selectedProjectId,
        selectProject,
        editingProjectId,
        editProject,
        createProject,
        updateProject,
        deleteProject,
        addFile,
        removeFile,
      }}
    >
      {children}
    </ProjectsContext>
  );
}
