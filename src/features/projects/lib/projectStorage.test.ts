import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { readBlob } from "@/shared/lib/opfs-core";
import { exportFolderAsZip, importFolderFromZip } from "@/shared/lib/opfs-zip";
import { createProjectTools, projectInstructions } from "./projectTools";
import { deleteProjectFile, loadProject, projectStorage, readProjectFile, saveProjectFile } from "./projectStorage";
import { isProject, projectFileName, type Project } from "./projects";
import { FileSystemManager } from "@/features/artifacts/lib/fs";

const disk = new MemoryOpfs();
const makeProject = (id: string): Project => ({
  id,
  name: id,
  description: "Quarterly planning",
  instructions: `Instructions for ${id}`,
  files: [],
  created: "2026-01-01",
  updated: "2026-01-02",
});
beforeEach(() => {
  disk.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => disk.root } });
  vi.stubGlobal(
    "FileReader",
    class {
      result = "";
      onload = () => {};
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((bytes) => {
          this.result = `data:${blob.type};base64,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`;
          this.onload();
        });
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("projects", () => {
  it("round trips shared files, instructions and project listings through a backup", async () => {
    const project = makeProject("one");
    await projectStorage.store(project);
    const file = await saveProjectFile(project, new File(["Revenue: 42"], "notes.txt", { type: "text/plain" }), {
      chatId: "source",
      path: "/report.txt",
      revision: "sha256:abc",
    });
    project.files.push(file);
    await projectStorage.store(project);
    const backup = await exportFolderAsZip("projects");
    disk.reset();
    await importFolderFromZip("", backup);
    const restored = (await loadProject("one"))!;
    expect(restored).toEqual(project);
    expect((await projectStorage.load()).map((p) => p.id)).toEqual(["one"]);
    expect(await readProjectFile(restored, "/notes.txt")).toMatchObject({ content: "Revenue: 42" });
  });

  it("deletes a removed file's bytes and keeps the other files", async () => {
    const project = makeProject("one");
    await projectStorage.store(project);
    const kept = await saveProjectFile(project, new File(["keep"], "keep.txt", { type: "text/plain" }));
    const removed = await saveProjectFile(project, new File(["drop"], "drop.txt", { type: "text/plain" }));
    project.files.push(kept, removed);
    await projectStorage.store(project);
    project.files = [kept];
    await projectStorage.store(project);
    await deleteProjectFile(project.id, removed.id);
    await deleteProjectFile(project.id, removed.id);
    expect(await readBlob(`projects/one/files/${removed.id}`)).toBeUndefined();
    expect(await readProjectFile(project, "/keep.txt")).toMatchObject({ content: "keep" });
  });

  it("exposes only current project files and copies binaries without overwriting conversation files", async () => {
    const project = makeProject("one");
    await projectStorage.store(project);
    project.files.push(
      await saveProjectFile(
        project,
        new File([new Uint8Array([0, 255])], "data.bin", { type: "application/octet-stream" }),
      ),
    );
    await projectStorage.store(project);
    const other = makeProject("two");
    await projectStorage.store(other);
    expect(await readProjectFile(other, "/data.bin")).toBeUndefined();
    const fs = new FileSystemManager("chat-one");
    await fs.createFile("/data.bin", "existing", "text/plain");
    const before = await fs.getFile("/data.bin");
    const copy = createProjectTools(project).find((tool) => tool.name === "project_copy")!;
    const result = await copy.execute({ path: "/data.bin" }, { context: { chatId: "chat-one" }, emitCustomEvent() {} });
    const path = JSON.parse((result[0] as { content: string }).content).path;
    expect(path).not.toBe("/data.bin");
    expect(await fs.getFile("/data.bin")).toEqual(before);
    expect((await fs.getFile(path))?.content).toBe("data:application/octet-stream;base64,AP8=");
    expect(projectInstructions(project)).toContain("Instructions for one");
    expect(projectInstructions(project)).not.toContain("Instructions for two");
  });

  it("rejects invalid metadata and keeps duplicate uploads distinct", () => {
    const project = makeProject("one");
    expect(isProject(project)).toBe(true);
    expect(isProject({ ...project, id: "../outside" })).toBe(false);
    expect(isProject({ ...project, files: [{ id: "ok", name: "../notes.txt", path: "/../notes.txt", size: 1 }] })).toBe(
      false,
    );
    expect(projectFileName("notes.txt", [{ id: "existing", name: "NOTES.txt", path: "/NOTES.txt" }])).toBe(
      "notes (2).txt",
    );
  });
});
