/**
 * Migration Registry — Documents every active backward-compatibility path.
 *
 * Generated: 2026-02-27
 *
 * Each entry describes a migration or compat shim still present in the codebase,
 * including its location, what formats it bridges, and its removal timeline.
 */

export interface MigrationEntry {
  /** kebab-case identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** File(s) + line(s) where the migration/compat code lives */
  locations: { file: string; lines: string }[];
  /** What old format it handles */
  oldFormat: string;
  /** What new format it converts to */
  newFormat: string;
  /** Expiry / planned removal date (null = none stated) */
  expiry: string | null;
  /** "read-only-compat" = reads old format on demand; "write-migration" = actively converts and persists */
  kind: 'read-only-compat' | 'write-migration';
}

export const MIGRATION_REGISTRY: MigrationEntry[] = [
  // ===========================================================================
  // 1. IndexedDB → OPFS bulk migration
  // ===========================================================================
  {
    id: 'indexeddb-to-opfs',
    title: 'IndexedDB → OPFS one-time migration',
    locations: [
      { file: 'src/features/settings/lib/migration.ts', lines: '1-536' },
    ],
    oldFormat:
      'All app data (chats, repositories, images, bridge servers, profile, skills) stored in IndexedDB "wingman" database, single object-store keyed by type',
    newFormat:
      'Folder-per-entity structure in OPFS: chats/{id}/chat.json, repositories/{id}.json, images/{id}/, bridge.json, profile.json, skills.json',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 2. V1 chat message format migration (import support)
  // ===========================================================================
  {
    id: 'v1-chat-message-format',
    title: 'V1 chat message format → current Content[] schema',
    locations: [
      { file: 'src/features/settings/lib/v1Migration.ts', lines: '16-145' },
    ],
    oldFormat:
      'Messages with: string content, separate mimeType+data fields, attachments[] array, toolCalls/toolResult objects, role "tool", reasoning field',
    newFormat:
      'Messages with: Content[] (TextContent | ImageContent | AudioContent | FileContent | ToolCallContent | ToolResultContent | ReasoningContent), data URLs, role "user"/"assistant"',
    expiry: 'April 2026 (stated in file header)',
    kind: 'write-migration',
  },

  // ===========================================================================
  // 3. V1 chat-level migration (date strings, message array)
  // ===========================================================================
  {
    id: 'v1-chat-dates',
    title: 'Chat date string → Date object normalisation',
    locations: [
      { file: 'src/features/settings/lib/v1Migration.ts', lines: '140-163' },
    ],
    oldFormat:
      'Chat.created / Chat.updated stored as ISO-8601 strings (or missing)',
    newFormat: 'Date objects (or null)',
    expiry: 'April 2026 (same module)',
    kind: 'write-migration',
  },

  // ===========================================================================
  // 4. V1 repository format migration
  // ===========================================================================
  {
    id: 'v1-repository-format',
    title: 'Old repository format → current Repository schema',
    locations: [
      { file: 'src/features/settings/lib/v1Migration.ts', lines: '165-270' },
    ],
    oldFormat:
      'Repository with embedded files (text+vectors inline), date strings, optional missing fields (embedder, progress)',
    newFormat:
      'Repository with properly typed files, Date objects, default embedder, guaranteed required fields',
    expiry: 'April 2026 (same module)',
    kind: 'write-migration',
  },

  // ===========================================================================
  // 5. V1 skill format migration
  // ===========================================================================
  {
    id: 'v1-skill-format',
    title: 'Old skill JSON / raw string → current Skill schema',
    locations: [
      { file: 'src/features/settings/lib/v1Migration.ts', lines: '278-326' },
    ],
    oldFormat:
      'Skill as plain JSON object (possibly with "instructions" instead of "content", missing id/enabled) or raw SKILL.md string',
    newFormat:
      'Skill with id, name, description and content fields',
    expiry: 'April 2026 (same module)',
    kind: 'write-migration',
  },

  // ===========================================================================
  // 6. Legacy JSON chat import (uses migrateChat)
  // ===========================================================================
  {
    id: 'legacy-json-chat-import',
    title: 'Legacy JSON chat export import → OPFS chat folders',
    locations: [
      { file: 'src/features/settings/lib/chatImportExport.ts', lines: '13-60' },
    ],
    oldFormat:
      '{ chats: [...] } JSON export with V1-era message format',
    newFormat:
      'OPFS chats/{id}/chat.json with blob-extracted media, plus artifacts folder',
    expiry: 'April 2026 (depends on v1Migration.ts)',
    kind: 'write-migration',
  },

  // ===========================================================================
  // 7. Legacy JSON agent/repository import
  // ===========================================================================
  {
    id: 'legacy-json-agent-import',
    title: 'Legacy JSON repository export → OPFS agent folders',
    locations: [
      { file: 'src/features/settings/lib/agentImportExport.ts', lines: '12-96' },
    ],
    oldFormat:
      '{ repositories: [...] } JSON export with embedded files (text + vectors inline)',
    newFormat:
      'OPFS agents/{id}/AGENTS.md + agents/{id}/files/{fileId}/ folder structure',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 8. Legacy repository ZIP import
  // ===========================================================================
  {
    id: 'legacy-repo-zip-import',
    title: 'Legacy repository ZIP format → agent folder structure',
    locations: [
      { file: 'src/features/settings/lib/agentImportExport.ts', lines: '236-287' },
    ],
    oldFormat:
      'ZIP with {uuid}/repository.json + {uuid}/files/... (old repository export)',
    newFormat:
      'OPFS agents/{newId}/AGENTS.md + agents/{newId}/files/... (new agent format)',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 9. Repository → Agent one-time migration
  // ===========================================================================
  {
    id: 'repo-to-agent-migration',
    title: 'OPFS repositories + bridge.json + skills → agents collection',
    locations: [
      { file: 'src/features/agent/context/AgentProvider.tsx', lines: '280-478' },
    ],
    oldFormat:
      'Separate OPFS collections: repositories/{id}/ (folder or flat .json), bridge.json, skills — loaded independently',
    newFormat:
      'Unified agents/{id}/ folders with AGENTS.md, servers.json, files/; guarded by agents/.migrated flag',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 10. Flat-file repository compat in agent migration
  // ===========================================================================
  {
    id: 'flat-repo-json-compat',
    title: 'Flat repositories/{id}.json → agent folder structure',
    locations: [
      { file: 'src/features/agent/context/AgentProvider.tsx', lines: '370-430' },
    ],
    oldFormat:
      'repositories/{id}.json — single JSON file with embedded files/segments/vectors (written by IndexedDB migration)',
    newFormat:
      'agents/{id}/files/{fileId}/ folder structure with metadata.json, content.txt, segments.json, embeddings.bin',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 11. Agent load: AGENT.md (singular) fallback
  // ===========================================================================
  {
    id: 'agent-md-singular-fallback',
    title: 'AGENT.md (singular) fallback when loading agent metadata',
    locations: [
      { file: 'src/features/agent/context/AgentProvider.tsx', lines: '158-175' },
      { file: 'src/shared/lib/opfs-zip.ts', lines: '116-123' },
      { file: 'src/features/settings/lib/agentImportExport.ts', lines: '37-39' },
    ],
    oldFormat:
      'Agent metadata stored in AGENT.md (singular filename)',
    newFormat:
      'Agent metadata stored in AGENTS.md (plural filename)',
    expiry: null,
    kind: 'read-only-compat',
  },

  // ===========================================================================
  // 12. Agent load: agent.json fallback
  // ===========================================================================
  {
    id: 'agent-json-fallback',
    title: 'Legacy agent.json fallback when loading agent metadata',
    locations: [
      { file: 'src/features/agent/context/AgentProvider.tsx', lines: '178-193' },
    ],
    oldFormat:
      'Agent metadata stored in agent.json with name, instructions, skills, servers, tools all in one JSON object',
    newFormat:
      'AGENTS.md (YAML frontmatter + markdown body) + servers.json (separate file)',
    expiry: null,
    kind: 'read-only-compat',
  },

  // ===========================================================================
  // 13. Agent load: servers inline in agent.json
  // ===========================================================================
  {
    id: 'agent-servers-inline-compat',
    title: 'Bridge servers embedded in agent.json → separate servers.json',
    locations: [
      { file: 'src/features/agent/context/AgentProvider.tsx', lines: '194-200' },
    ],
    oldFormat:
      'servers[] array embedded inside agent.json',
    newFormat:
      'Separate servers.json file; only loaded from servers.json when not already populated from agent.json',
    expiry: null,
    kind: 'read-only-compat',
  },

  // ===========================================================================
  // 14. Skills: skills.json → folder-based migration
  // ===========================================================================
  {
    id: 'skills-json-to-folders',
    title: 'Legacy skills.json → skills/{name}/ folder structure',
    locations: [
      { file: 'src/features/skills/context/SkillsProvider.tsx', lines: '25-40' },
    ],
    oldFormat:
      'All skills in a single skills.json array (written by IndexedDB migration)',
    newFormat:
      'skills/{name}/SKILL.md per-skill folder structure; legacy file is deleted after migration',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 15. Profile: localStorage → OPFS migration
  // ===========================================================================
  {
    id: 'profile-localstorage-to-opfs',
    title: 'Profile settings from localStorage → OPFS profile.json',
    locations: [
      { file: 'src/features/settings/context/ProfileProvider.tsx', lines: '38-52' },
      { file: 'src/shared/hooks/usePersistedState.ts', lines: '17-19 (migrate option), 93-100 (migration logic)' },
    ],
    oldFormat:
      'Profile settings stored in localStorage under key "profile-settings" (with possible stale "instructions" field)',
    newFormat:
      'profile.json in OPFS (minus "instructions" field); localStorage key removed after migration',
    expiry: null,
    kind: 'write-migration',
  },

  // ===========================================================================
  // 16. Comma-separated skill/tool list parsing
  // ===========================================================================
  {
    id: 'agent-md-comma-list-compat',
    title: 'Comma-separated skills/tools values in AGENTS.md frontmatter',
    locations: [
      { file: 'src/features/agent/context/AgentProvider.tsx', lines: '70-82' },
    ],
    oldFormat:
      'skills: a, b, c  (comma-separated, no brackets)',
    newFormat:
      "skills: ['a', 'b', 'c']  (YAML bracket array with quotes)",
    expiry: null,
    kind: 'read-only-compat',
  },

  // ===========================================================================
  // 17. MCP tool result format compat
  // ===========================================================================
  {
    id: 'mcp-tool-result-compat',
    title: 'MCP SDK old toolResult wrapper → current CallToolResult',
    locations: [
      { file: 'src/features/settings/lib/mcp.ts', lines: '142-146' },
    ],
    oldFormat:
      'MCP callTool response wrapped in { toolResult: CallToolResult } (older SDK versions)',
    newFormat:
      'MCP callTool response is CallToolResult directly (content field at top level)',
    expiry: null,
    kind: 'read-only-compat',
  },

  // ===========================================================================
  // 18. rebuildFolderIndex metadata detection chain
  // ===========================================================================
  {
    id: 'rebuild-index-metadata-chain',
    title: 'rebuildFolderIndex multi-format metadata detection',
    locations: [
      { file: 'src/shared/lib/opfs-zip.ts', lines: '83-140' },
    ],
    oldFormat:
      'Agent/entity metadata in AGENT.md (singular), agent.json, repository.json, or metadata.json',
    newFormat:
      'AGENTS.md (plural) as primary; falls through to legacy JSON metadata files for title/updated extraction',
    expiry: null,
    kind: 'read-only-compat',
  },

  // ===========================================================================
  // 19. Chat blob extraction: Date → ISO string in StoredChat
  // ===========================================================================
  {
    id: 'chat-date-to-iso',
    title: 'Chat created/updated Date → ISO string on extract',
    locations: [
      { file: 'src/shared/lib/opfs-chat.ts', lines: '175-180' },
    ],
    oldFormat:
      'Chat.created / Chat.updated as Date objects (runtime type)',
    newFormat:
      'StoredChat.created / .updated as ISO-8601 strings (or null) for JSON serialisation',
    expiry: null,
    kind: 'write-migration',
  },
];
