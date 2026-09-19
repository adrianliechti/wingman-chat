# Ideas for extending Wingman Chat

Reviewed: 2026-09-19. This is a feature backlog for discussion; priorities and effort are estimates.

Wingman already combines chat, agents, files, research, voice, and content creation. The next useful
step is to make work easier to organize, revisit, refine, and repeat.

**Suggested starting point:** saved composer drafts, artifact revision history, and better search
results. **Next larger investment:** projects that bring related conversations and files together.

## Inspiration

- [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes):
  branching from a message (September 4, 2025), scheduled task management (June 17, 2026), large
  pastes as attachments (August 4, 2026), file reuse and search improvements (August 7, 2026), and
  temporary chat controls (August 27, 2026).
- [Claude release notes](https://support.claude.com/en/articles/12138966-release-notes): recurring
  tasks (February 25, 2026), editing drafts beside a conversation (June 12, 2026), remote work that
  continues with devices offline (July 7, 2026), editable memory topics (August 25, 2026), and reports
  on usage and repeated workflows (September 10, 2026).

The proposals below adapt these themes to Wingman's existing code and add Wingman-specific ideas.
They do not assume that a feature in either product is available through an OpenAI-compatible API.

## What already exists

Use these as foundations when choosing work:

| Area | Existing capability |
| --- | --- |
| Conversations | Title and message-text search, pinned chats, renaming, whole-chat forks, message editing, and response retries. See [sidebar](src/features/chat/components/ChatSidebar.tsx) and [chat store](src/features/chat/lib/chatStore.ts). |
| Artifacts | Per-chat files, previews, downloads, generated documents and interactive HTML, plus archived revisions in storage. See [workspace UI](src/features/artifacts/components/ArtifactsDrawer.tsx) and [file system](src/features/artifacts/lib/fs.ts). |
| Memory | Agent memory can be added, edited, forgotten, and inspected with source links. See [memory settings](src/features/agent/components/MemorySection.tsx). |
| Research and knowledge | Web search and a research agent, uploaded document retrieval, and optional cloud drives. See [research provider](src/features/research/hooks/useInternetProvider.ts) and [repository tools](src/features/repository/lib/repository-tools.ts). |
| Extensibility | Configurable agents, skills, a skill builder, MCP connections, interactive MCP apps, and a plugin hub. Hub installation currently imports skills; declared MCP servers are informational. See [README](README.md). |
| Media and portability | Voice conversations, transcription, image generation, translation, and chat import/export. Chat storage uses browser OPFS. See [README](README.md), [chat storage](src/shared/lib/opfs-chat.ts), and [export tools](src/features/settings/lib/chatImportExport.ts). |

## Priorities and effort

- **P1:** improvements to frequent everyday interactions.
- **P2:** broader workflows built on existing capabilities.
- **P3:** extensions that require substantial server or collaboration infrastructure.
- **S / M / L:** small, medium, or large relative scope for the first version; not delivery dates.

## P1 — Everyday improvements

### 1. Saved composer drafts and large-paste handling — S–M

- **Value:** switching conversations or refreshing the page should preserve unfinished work.
- **First version:** save unsent text and attachment references per conversation, including the new-chat
  draft. Restore after reload and clear after sending. Offer to turn a large paste into a named text
  attachment, with a way to put it back in the composer.
- **Builds on:** the existing composer and persistence utilities. Today the composer text is component
  state. Keep draft saving separate from the queue of messages already submitted during a run.

### 2. Search that opens the relevant passage — M

- **Value:** find an earlier decision or answer without scrolling through an entire conversation.
- **First version:** show matching excerpts, highlight matches, and jump to the message. Add date and
  model filters. Introduce an incremental local index as histories grow; later include artifact names
  and extracted document text in the same search surface.
- **Builds on:** current title and message-text search, which returns matching conversation IDs.

### 3. Branch from any message, with visible ancestry — M

- **Value:** explore another approach or model while retaining the original conversation.
- **First version:** add “Branch from here” to a message, keep a link to its parent conversation, and
  show sibling branches. Copy the history up to that point and the referenced artifact revisions so
  the new branch can evolve independently.
- **Builds on:** the existing whole-chat fork. The extension is the branch point, navigation, and
  consistent handling of attached and generated files.

### 4. Artifact revision history, comparison, and restore — M

- **Value:** recover a previous draft or see what changed after asking for a revision.
- **First version:** a history panel listing revisions and the turn that produced each one. Support
  text diffs for Markdown, code, and CSV; preview or download other formats. Restore an older revision
  as a new current revision so history remains available.
- **Builds on:** archived artifact revisions and durable artifact references already present in storage.

### 5. Temporary conversations — M

- **Value:** handle a one-off question without adding it to saved history or an agent's memory.
- **First version:** an explicit temporary mode with no memory recall or learning, no saved chat or
  search entry, and session-scoped artifacts. Offer “Save conversation” before leaving.
- **Dependency:** apply the mode consistently to drafts, attachments, tools, and sub-agents. Explain
  the local retention behavior separately from the configured provider's logging or retention policy.

## P2 — Larger workflows

### 6. Projects with shared context — L

- **Value:** keep a client's work, a research topic, or a product launch together across conversations.
- **First version:** project name and icon, grouped chats, project instructions, and a shared file
  collection. Let users move existing chats into a project and choose an agent for each conversation.
- **Next step:** project-scoped memory and retrieval, with an explicit choice to use broader personal
  context. Keep project membership separate from agent selection so an agent can serve several projects.
- **Dependency:** introduce project identity in persistence and define instruction precedence and
  context boundaries before adding automatic recall across project chats.

### 7. A reusable file library — M–L

- **Value:** reuse a reference document, brand asset, or generated report in another conversation.
- **First version:** “Save to library” on an artifact and “Add from library” in the composer. Browse,
  search, tag, and preview saved files; retain the originating conversation and revision.
- **Builds on:** per-chat artifacts, agent knowledge files, and cloud drive browsing. Make the choice
  between copying a fixed revision and following an updated source visible to the user.

### 8. Direct editing and targeted artifact changes — M–L

- **Value:** fix a paragraph or refine one section without asking for a whole new document.
- **First version:** editable Markdown and text beside the chat. Select a passage, request a change,
  inspect a proposed diff, and accept or discard it. Save manual and accepted AI edits as revisions.
- **Builds on:** the preview workspace and revision storage. Start with text; preserving native Office
  formatting during fine-grained edits is a separate expansion.

### 9. A context, memory, and usage inspector — M

- **Value:** understand the context supplied to an answer and control what carries into the next turn.
- **First version:** show active instructions, retrieved passages, recalled memory, and the latest
  conversation summary. Link memory entries to the existing editor and allow exclusion from the next
  turn. Show recorded input/output usage and label context-budget estimates clearly.
- **Next step:** inspect proposed memory changes and aggregate usage by conversation or project. Show
  cost estimates only when the deployment supplies pricing; preserve unknown or partial usage.
- **Builds on:** memory source metadata, conversation summarization, per-response token counts, and
  telemetry. Expose recorded inputs and events rather than inferring why the model answered as it did.

### 10. A research workspace with inspectable evidence — M–L

- **Value:** turn web research and document retrieval into a report whose sources are easy to verify.
- **First version:** a research brief, source list, progress view, and report artifact. Open a citation
  beside the report at its supporting passage; let users exclude a source and regenerate affected work.
- **Next step:** source-domain filters, comparison of conflicting evidence, and refreshing a saved
  report while highlighting changed findings.
- **Builds on:** the existing research agent, document retrieval, and artifacts. Preserve source URLs,
  retrieval times, and passage identifiers instead of relying only on generated citation text.

### 11. Compare models on the same prompt — M

- **Value:** use Wingman's multi-model support to choose an answer or discover which model suits a task.
- **First version:** send one prompt and a fixed context snapshot to two selected models, display the
  responses side by side, and continue from either result as its own conversation. Show available
  latency and token usage.
- **Dependency:** keep each run's history and artifacts separate. Begin with text responses; add tool
  execution after accounting for duplicate external actions and separate execution budgets.

### 12. Turn a successful conversation into a reusable workflow — M

- **Value:** repeat a useful process such as preparing a weekly report without rebuilding the prompt.
- **First version:** “Save as workflow” drafts a skill from a selected conversation, lets the user review
  instructions and required inputs, and saves an example output. Running it opens a fresh conversation
  with a short input form and the selected agent.
- **Builds on:** the skill builder and skill library. Package reusable instructions and chosen resources;
  keep account credentials and conversation-specific data out of the template.

### 13. Complete plugin and connector setup — M–L

- **Value:** make an installed plugin's required tools discoverable and straightforward to connect.
- **First version:** show missing connections, authentication status, and a test action. Offer to create
  a compatible MCP connection from a plugin's declared server after the user reviews it. Show which
  account and tools each agent uses.
- **Builds on:** hub installation, MCP configuration, and authentication support. Handle unsupported
  server types explicitly; do not treat downloading a skill as authorizing its external connections.

### 14. Meeting transcripts with traceable decisions — M–L

- **Value:** turn a recording into decisions, action items, and a useful follow-up document.
- **First version:** upload recorded audio, keep a timestamped transcript, and generate minutes whose
  decisions link back to transcript passages. Let users correct the transcript and regenerate the notes.
- **Builds on:** audio ingestion, transcription, and document generation. Speaker labels depend on the
  configured transcription provider; live meeting capture can follow after the upload workflow works.

### 15. Visual feedback for image iteration — M

- **Value:** point to the part of an image or screenshot that needs attention.
- **First version:** draw a rectangle or annotation on a preview, add an instruction, and submit the
  annotated reference with the source image. Keep related variants together for comparison.
- **Builds on:** Canvas, image attachments, and screen capture. Region masking can be an additional
  control where the configured image provider supports it.

## P3 — Server-backed extensions

### 16. Background runs and scheduled tasks — L

- **Value:** let a research job finish after closing the tab, or generate a report every Monday.
- **First version:** a server-managed job with durable status, cancellation, result retrieval, and a
  completion inbox. Then add one-time and recurring schedules with timezone, next run, pause, and
  execution history. Add event triggers only after scheduled execution is reliable.
- **Dependency:** persistent server storage, a worker, scoped credentials, and a tool runtime that can
  execute without browser OPFS or Pyodide. Start with a supported subset of tools. Handle retries,
  duplicate actions, approval requests, and per-job budgets explicitly.

### 17. Optional sync across devices — L

- **Value:** continue a conversation or access a saved artifact on another device.
- **First version:** authenticated sync of conversations and attachments, with clear upload status,
  deletion propagation, and conflict handling. Extend to projects, skills, and memory afterward.
- **Builds on:** local persistence and existing export/import. Keep local-only deployments available;
  define server ownership, migrations, and backup behavior before syncing browser data automatically.

### 18. Share selected conversations and artifacts — L

- **Value:** send a useful result to a colleague who should not need the entire workspace export.
- **First version:** an explicit snapshot of selected messages and files, a recipient preview, read-only
  access, and revocation. Allow copying a shared result into a new personal conversation.
- **Dependency:** server storage and access controls. Exclude hidden context, memory, credentials, and
  tool metadata from the shared snapshot. Build live collaboration and comments as later additions.

## How to choose the first implementation

1. Start with **saved drafts** for a small improvement that is easy to validate through reloads and
   conversation switching.
2. Add **artifact history** to expose value already supported by storage. Validate that a restored file
   survives reload and that references to earlier revisions still open the correct content.
3. Improve **search results** so a known phrase leads directly to its message, including in long histories.
4. Design **projects** as the next larger feature, then use that structure for shared files and scoped memory.

Keep each first version independently useful. Preserve deployment feature flags and model capability
checks, and treat server-backed work as an optional deployment capability.
