import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProvider } from "../../../src/features/agent/context/AgentProvider";
import { useAgents } from "../../../src/features/agent/hooks/useAgents";
import { useChats } from "../../../src/features/chat/hooks/useChats";
import { SkillsProvider } from "../../../src/features/skills/context/SkillsProvider";
import { useSkills } from "../../../src/features/skills/hooks/useSkills";
import { useImages } from "../../../src/features/canvas/hooks/useImages";
import { usePersistedState } from "../../../src/shared/hooks/usePersistedState";
import { loadConfig } from "../../../src/shared/config";
import * as opfs from "../../../src/shared/lib/opfs";
import { flushPersistence } from "../../../src/shared/lib/persistence";

await loadConfig();
let release: (() => void) | undefined;
let held = false;
let lastFlush: Promise<void> = Promise.resolve();

function holdWrite(path: string, fail = false) {
  held = false;
  // oxlint-disable-next-line typescript/unbound-method -- The wrapper forwards the original receiver with .call.
  const original = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const segments = await (await navigator.storage.getDirectory()).resolve(this);
    if (segments?.join("/") !== path) return original.call(this, options);
    FileSystemFileHandle.prototype.createWritable = original;
    const stream = await original.call(this, options);
    const write = stream.write.bind(stream);
    stream.write = async (data) => {
      held = true;
      if (fail) throw new DOMException("Injected quota failure", "QuotaExceededError");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return write(data);
    };
    return stream;
  };
}

function holdRead(path: string) {
  held = false;
  // oxlint-disable-next-line typescript/unbound-method -- The wrapper forwards the original receiver with .call.
  const original = FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile = async function () {
    const segments = await (await navigator.storage.getDirectory()).resolve(this);
    if (segments?.join("/") !== path) return original.call(this);
    FileSystemFileHandle.prototype.getFile = original;
    const file = await original.call(this);
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return file;
  };
}

type Profile = { name?: string; role?: string };
function ProfileFixture({ storageKey }: { storageKey: string }) {
  const profile = usePersistedState<Profile>({
    key: storageKey,
    defaultValue: {},
    debounceMs: 1000,
    onSave: (value) => (value.name ? value : undefined),
  });
  window.profileE2E = profile;
  return <span data-testid="profile">{profile.value.name ?? "empty"}</span>;
}

function Fixture() {
  const chats = useChats();
  const agents = useAgents();
  const skills = useSkills();
  const images = useImages();
  const [showProfile, setShowProfile] = useState(true);
  const [storageKey, setStorageKey] = useState("profile.json");
  const api = {
    state: () => ({
      ready: chats.isLoaded && images.isLoaded,
      chats: chats.chats,
      agents: agents.agents,
      currentAgent: agents.currentAgent,
      skills: skills.skills,
      images: images.images,
    }),
    createChat: chats.createChat,
    updateChat: chats.updateChat,
    deleteChat: chats.deleteChat,
    createAgent: agents.createAgent,
    updateAgent: agents.updateAgent,
    deleteAgent: agents.deleteAgent,
    upsertFile: agents.upsertFile,
    removeFile: agents.removeFile,
    addServer: agents.addServer,
    toggleServer: agents.toggleServer,
    addSkill: skills.addSkill,
    updateSkill: skills.updateSkill,
    removeSkill: skills.removeSkill,
    createImage: images.createImage,
    deleteImage: images.deleteImage,
    flush: flushPersistence,
    startFlush: () => {
      lastFlush = flushPersistence();
      void lastFlush.catch(() => {});
    },
    finishFlush: () => lastFlush,
    read: opfs.readJson,
    write: opfs.writeJson,
    list: opfs.listDirectories,
    holdWrite,
    holdRead,
    held: () => held,
    release: () => release?.(),
    showProfile: setShowProfile,
    setStorageKey,
    backup: async () => Array.from(new Uint8Array(await (await opfs.exportFolderAsZip("/")).arrayBuffer())),
    restore: (bytes: number[]) => opfs.importFolderFromZip("/", new Blob([new Uint8Array(bytes)])),
  };
  window.persistenceE2E = api;
  return <>{showProfile && <ProfileFixture storageKey={storageKey} />}</>;
}

declare global {
  interface Window {
    persistenceE2E: {
      state: () => {
        ready: boolean;
        chats: import("../../../src/shared/types/chat").Chat[];
        agents: import("../../../src/features/agent/types/agent").Agent[];
        currentAgent: import("../../../src/features/agent/types/agent").Agent | null;
        skills: ReturnType<typeof useSkills>["skills"];
        images: ReturnType<typeof useImages>["images"];
      };
      createChat: ReturnType<typeof useChats>["createChat"];
      updateChat: ReturnType<typeof useChats>["updateChat"];
      deleteChat: ReturnType<typeof useChats>["deleteChat"];
      createAgent: ReturnType<typeof useAgents>["createAgent"];
      updateAgent: ReturnType<typeof useAgents>["updateAgent"];
      deleteAgent: ReturnType<typeof useAgents>["deleteAgent"];
      upsertFile: ReturnType<typeof useAgents>["upsertFile"];
      removeFile: ReturnType<typeof useAgents>["removeFile"];
      addServer: ReturnType<typeof useAgents>["addServer"];
      toggleServer: ReturnType<typeof useAgents>["toggleServer"];
      addSkill: ReturnType<typeof useSkills>["addSkill"];
      updateSkill: ReturnType<typeof useSkills>["updateSkill"];
      removeSkill: ReturnType<typeof useSkills>["removeSkill"];
      createImage: ReturnType<typeof useImages>["createImage"];
      deleteImage: ReturnType<typeof useImages>["deleteImage"];
      flush: typeof flushPersistence;
      startFlush: () => void;
      finishFlush: () => Promise<void>;
      read: typeof opfs.readJson;
      write: typeof opfs.writeJson;
      list: typeof opfs.listDirectories;
      holdWrite: typeof holdWrite;
      holdRead: typeof holdRead;
      held: () => boolean;
      release: () => void;
      showProfile: (show: boolean) => void;
      setStorageKey: (key: string) => void;
      backup: () => Promise<number[]>;
      restore: (bytes: number[]) => Promise<void>;
    };
    profileE2E: ReturnType<typeof usePersistedState<Profile>>;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SkillsProvider>
      <AgentProvider>
        <Fixture />
      </AgentProvider>
    </SkillsProvider>
  </StrictMode>,
);
