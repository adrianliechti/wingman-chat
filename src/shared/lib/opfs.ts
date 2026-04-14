/**
 * OPFS (Origin Private File System) Storage Layer — Barrel re-export.
 *
 * Implementation is split across domain-oriented modules:
 * - opfs-core.ts      — File/folder CRUD, index management, storage usage, data URL utilities
 * - opfs-chat.ts      — Chat-scoped blob storage, extraction/rehydration pipeline
 * - opfs-artifacts.ts — Artifact CRUD within chat folders
 * - opfs-skills.ts    — Skill CRUD and SKILL.md serialization
 * - opfs-zip.ts       — ZIP export/import, agent/skill bundling
 */

export * from "./opfs-artifacts";
export * from "./opfs-chat";
export * from "./opfs-core";
export * from "./opfs-skills";
export * from "./opfs-zip";
