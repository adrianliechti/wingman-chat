import { createContext, useContext } from "react";
import type { Project, ProjectFile } from "../lib/projects";

export interface ProjectsContextValue {
  projects: Project[];
  isLoaded: boolean;
  selectedProjectId: string | null;
  selectProject: (id: string | null) => void;
  editingProjectId: string | null;
  editProject: (id: string | null) => void;
  createProject: (name: string) => Promise<Project>;
  updateProject: (
    id: string,
    changes: Partial<Pick<Project, "name" | "description" | "instructions">>,
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addFile: (id: string, file: File, source?: ProjectFile["source"]) => Promise<void>;
  removeFile: (id: string, fileId: string) => Promise<void>;
}

const unavailable = async (): Promise<never> => {
  throw new Error("Projects are unavailable");
};
export const ProjectsContext = createContext<ProjectsContextValue>({
  projects: [],
  isLoaded: true,
  selectedProjectId: null,
  selectProject() {},
  editingProjectId: null,
  editProject() {},
  createProject: unavailable,
  updateProject: unavailable,
  deleteProject: unavailable,
  addFile: unavailable,
  removeFile: unavailable,
});
export const useProjects = () => useContext(ProjectsContext);
