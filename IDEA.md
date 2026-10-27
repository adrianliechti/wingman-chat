# Wingman Chat TODO

Reviewed against the codebase and official product updates on 2026-10-27. Open items only.
Linked features are inspiration for Wingman; provider and gateway support must be checked separately.

## Conversations

- [ ] **Handle large pastes.** Offer to turn a long paste (ChatGPT uses about 10,000 characters) into a
      named text attachment, with a preview and a "Show in text field" action that moves it back into
      the composer. Inspiration: [ChatGPT what's new](https://learn.chatgpt.com/docs/whats-new).
- [ ] **Steer or queue follow-ups during a run.** Messages already queue while a reply runs. Let users
      choose between steering the current run at its next tool boundary and queueing for the next
      turn, with a default in settings. Extend the existing queued-message chips with edit, reorder,
      and send-now actions. Inspiration: [ChatGPT follow-up behavior](https://learn.chatgpt.com/codex/prompting)
      and [LibreChat v0.8.8](https://github.com/LibreChat-AI/LibreChat/releases/tag/v0.8.8).
- [ ] **Ask about a selected passage.** Select text in a reply to quote it into the composer, or open
      a side chat that answers from a snapshot of the conversation without adding to the main thread.
      Reuse the artifact selection popover. Inspiration:
      [Ask Copilot in Teams](https://support.microsoft.com/en-US/teams/copilot/ask-copilot-microsoft-teams)
      and [Perplexity Side Chat](https://www.perplexity.ai/changelog/effort-mode-gpt-6-astra-and-skills-marketplace).
- [ ] **Open search results at the matching message.** Show excerpts, highlight matches, and jump to
      the relevant passage instead of opening the conversation at its latest message.
- [ ] **Expand search.** Add type filters (chats, artifacts, images, documents), date and model
      filters, artifact names, extracted file and transcript text, and an incremental local search
      index for large histories. Inspiration:
      [ChatGPT unified search](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt).
- [ ] **Branch from a selected message.** Copy history up to that point, uploaded files, and the
      referenced artifact revisions. Show a "Branched from" link to the parent and allow branches of
      branches, without merging. Keep the replaced turns when a user message is edited, with a switcher
      between versions. Builds on the whole-chat fork. Inspiration: [Manus branching](https://manus.im/blog/manus-branch).
- [ ] **Show why a reply stopped.** Label each reply as completed, stopped, failed, or cut off at the
      output limit, and offer Continue or Retry where it applies. The gateway currently reports
      truncated responses as run errors. Inspiration:
      [big-AGI 2.1.3](https://github.com/enricoros/big-AGI/releases/tag/v2.1.3).
- [ ] **Edit assistant replies.** Let users correct a reply's text so later turns build on the
      corrected version, and keep the original as a version. Inspiration:
      [big-AGI 2.1.2](https://github.com/enricoros/big-AGI/releases/tag/v2.1.2).
- [ ] **Add temporary conversations.** Keep the chat, drafts, and artifacts out of saved history and
      disable memory recall and learning. Offer an explicit save action before leaving. Also allow
      turning memory off for a single saved chat before its first message, with a visible marker.
      Inspiration: [Claude memory controls](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context).
- [ ] **Compare models side by side.** Run the same prompt and context snapshot through two selected
      models, show available latency and usage, and continue from either answer in its own conversation.
      Start with text-only comparisons and a per-reply "try again with another model" action. Later,
      summarize where the answers agree and differ. Inspiration:
      [Copilot Switch Model](https://learn.microsoft.com/en-us/copilot/microsoft-365/release-notes) and
      [Perplexity Model Council](https://www.perplexity.ai/changelog/shared-workspaces-personal-computer-for-windows-and-model-council).

## Navigation and accessibility

- [ ] **Add a command palette and keyboard shortcuts.** Use Cmd/Ctrl+K to search, open, archive, or
      delete chats and to switch models or agents. Add shortcuts for new chat, stop, and focusing the
      composer, plus Up/Down for input history. Allow rebinding with conflict warnings. Inspiration:
      [Open WebUI 0.11.4](https://github.com/open-webui/open-webui/releases/tag/v0.11.4).
- [ ] **Navigate long conversations.** Add a rail of turns with jump-to-message. Inspiration:
      [Chatbox 1.22.1](https://github.com/chatboxai/chatbox/releases/tag/v1.22.1).
- [ ] **Translate the interface.** Extract UI strings, ship translations, and let operators reword
      labels per language without breaking placeholders. Inspiration:
      [Open WebUI 0.12.4](https://github.com/open-webui/open-webui/releases/tag/v0.12.4).
- [ ] **Improve accessibility.** Add a high-contrast mode, make menus, previews, and drawers fully
      keyboard reachable, announce streaming and approval requests to screen readers, and support
      right-to-left text. Inspiration:
      [Open WebUI 0.11.2](https://github.com/open-webui/open-webui/releases/tag/v0.11.2).

## Projects and reusable files

- [ ] **Use chats as project sources.** Add a conversation to a project's shared context and provide
      a project summary with links to the source material. Inspiration:
      [Gemini notebooks](https://blog.google/innovation-and-ai/products/gemini-app/notebooks-gemini-notebooklm/).
- [ ] **Add project memory.** Keep learned context within its project, with a toggle to leave
      personal memory out. Add project-scoped conversation retrieval. Shared project files,
      instructions, and sidebar chat search are already scoped. Inspiration:
      [Claude project memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context).
- [ ] **Expand the reusable file library.** Add search and tags to saved project files and attach them
      to another chat from the composer, next to OneDrive and SharePoint. Retain the source conversation
      and revision; distinguish a fixed copy from a file that follows updates to its source. Optionally
      let the assistant search the library. Inspiration:
      [ChatGPT Library](https://help.openai.com/en/articles/20001052-using-library-to-manage-files-in-chatgpt).
- [ ] **Work in a local folder.** Mount a folder through the File System Access API so the assistant
      reads and saves files there, with the same revision history as artifacts. It works only in
      Chromium browsers, so keep uploads as the fallback. Inspiration:
      [Perplexity local folders](https://www.perplexity.ai/changelog/ultrafast-computer-models-decisions-api-and-connector-controls).
- [ ] **Save results back to cloud drives.** Write generated or edited files to OneDrive or SharePoint,
      as a new version when the file came from there. Drives are import-only today. Inspiration:
      [Copilot Cowork](https://learn.microsoft.com/en-us/copilot/cowork/whats-new).

## Artifacts and media

- [ ] **Edit structured artifacts.** Edit cells in the data grid and chart data in generated decks,
      with save/cancel controls and revisions. Inspiration:
      [Claude's document and artifact editing](https://support.claude.com/en/articles/12138966-release-notes)
      and [Mistral spreadsheets in Canvas](https://docs.mistral.ai/resources/release-notes).
- [ ] **Review proposed AI edits before applying them.** Show changes as suggestion cards beside the
      text they change, each with Apply and Discard. Let users leave edit requests in several files and
      send them as one batch. Builds on select-to-edit, revision diffs, and the stale-write guard.
      Inspiration: [ChatGPT Space pages](https://learn.chatgpt.com/codex/space/pages) and
      [Claude edit requests](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them).
- [ ] **Show the query behind dashboard numbers.** In HTML dashboards over workspace data, click a
      chart or figure to see its SQL, ask for an explanation, and see when it was last computed.
      Inspiration: [Claude Dashboards](https://support.claude.com/en/articles/17454700-get-started-with-claude-dashboards).
- [ ] **Hide tools that need per-action approval from HTML artifacts.** Filter them out of
      `wingman.tools.list()`. Durable per-artifact storage and first-use tool consent already exist
      in the `window.wingman` SDK. Inspiration:
      [Claude artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them).
- [ ] **Apply a brand kit.** Save logos, fonts, colors, and templates once, per user or from the
      deployment, and have document, deck, and visual skills apply and check them. Inspiration:
      [Claude Design](https://claude.com/blog/claude-design-stays-on-brand-for-daily-work) and
      [Gemini brand kits](https://blog.google/innovation-and-ai/products/gemini-app/new-tools-small-business-owners/).
- [ ] **Add page thumbnails to PDF and DOCX previews.** Show selectable thumbnail rails, matching
      the existing PPTX viewer. Inspiration:
      [Perplexity](https://www.perplexity.ai/changelog/ultrafast-computer-models-decisions-api-and-connector-controls).
- [ ] **Extend inline UI.** Add timeline and zoomable-image components, and a preference for fewer
      visuals in replies. Inspiration: [Gemini release notes](https://gemini.google/release-notes/?hl=en)
      and [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes).
- [ ] **Annotate images and screenshots.** Mark a region, add an instruction, and send the annotation
      with the original image. Show all images in a chat on one canvas, comment on one or several, and
      pick a version. Offer masks when supported. Inspiration:
      [ChatGPT image canvas](https://learn.chatgpt.com/codex/image-generation).
- [ ] **Turn recordings into traceable meeting notes.** Keep an editable, timestamped transcript and
      link decisions and action items to playback positions. Include speaker labels when the provider
      supplies them, require accepting action items before export, and offer a "what did I miss"
      summary from any point. Builds on the `transcribe` command, which returns plain text. Inspiration:
      [Teams Facilitator](https://support.microsoft.com/en-us/teams/copilot/facilitator-in-microsoft-teams-meetings)
      and [Teams catch-up](https://support.microsoft.com/en-us/teams/copilot/catch-up-on-meetings-with-microsoft-365-copilot-in-teams).
- [ ] **Answer questions about video with timestamps.** Inspect visual segments as well as audio,
      and link answers to the relevant moments. Today only the audio track is transcribed. Inspiration:
      [Gemini video understanding](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-agentic-video-in-gemini/).
- [ ] **Generate video through supported providers.** Accept text and reference images that fix a
      character, product, or location; show job progress and cancellation, and save clips as artifacts.
      Inspiration: [Grok Imagine video references](https://x.ai/news/grok-imagine-video-1-5-references).

## Research

- [ ] **Make research steerable.** Show the research plan for editing before it starts, choose web,
      repository, drive, and upload sources with domain/date filters, and adjust the plan while it
      runs. Let research propose new sources for the repository. Today the brief can only be approved
      or declined. Inspiration: [Gemini Deep Research](https://support.google.com/gemini/answer/15719111).
- [ ] **Add an evidence panel.** Open citations beside the report at their supporting passages,
      retain retrieval times, surface conflicting evidence, and allow excluding individual sources.
- [ ] **Research lists of items in parallel.** Turn a list of companies, products, or documents into
      a comparison table with per-item progress, sources, retry controls, and a shared execution budget.
      Build on existing expandable sub-agent activity and results. Inspiration:
      [Manus Wide Research](https://manus.im/blog/manus-wide-research-solve-context-problem).
- [ ] **Refresh saved research.** Recheck a report's sources, highlight changed findings, and update
      the same artifact while retaining the previous version.

## Skills and connected apps

- [ ] **Extend composer context to chats and connected apps.** Skills already support `/` autocomplete;
      files use the attachment menu, including drives. Consider references to other chats and connected
      apps, with visible selections for the current request. Inspiration:
      [Gemini skills](https://blog.google/products-and-platforms/products/gemini/automate-tasks-with-skills/)
      and [connected apps](https://blog.google/innovation-and-ai/products/gemini-app/new-connected-apps-gemini/).
- [ ] **Turn conversations into reusable workflows.** Run forms now support named inputs, file slots,
      an example output and a fresh conversation with the chosen agent, with six common-work starters.
      Extend the skill builder with a conversation-to-workflow action and reviewed instructions.
      Offer an optional outline review before expensive generation. Inspiration:
      [Open WebUI chat variables](https://github.com/open-webui/open-webui/releases/tag/v0.11.0).
- [ ] **Share skills with colleagues.** Skills already import from files and export. Add installing
      from a URL with a preview, and publishing a skill to the deployment's library, with optional
      admin approval. Inspiration:
      [Perplexity Skills Marketplace](https://www.perplexity.ai/changelog/effort-mode-gpt-6-astra-and-skills-marketplace).
- [ ] **Draft skills from a screen recording.** Record a short demonstration with screen capture,
      then propose a new skill or an update to an existing one, and discard the recording. Inspiration:
      [Claude recorded skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills).
- [ ] **Set tool approval policies.** Let users set each tool or server to allow, ask, or off; allow
      read-only tools automatically; remember "don't ask again" per chat; and let a denial carry a
      reason back to the model. Add an ask-every-time or automatic mode in the composer, and let admins
      block some actions outright. Inspiration:
      [LobeHub connectors](https://github.com/lobehub/lobehub/blob/canary/docs/changelog/2026-06-08-connectors.mdx)
      and [Claude permission modes](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude).
- [ ] **Load tools on demand.** For large MCP catalogs, send tool names and descriptions only and let
      the model load full definitions through one search tool; keep pinned tools loaded. This keeps
      requests small and the prompt cache stable. Inspiration:
      [Open WebUI 0.12.0](https://github.com/open-webui/open-webui/releases/tag/v0.12.0).
- [ ] **Improve plugin connection setup.** Build on automatic connections for compatible remote MCP
      declarations. Add reviewed setup, missing-dependency and connected-account status, and a connection
      test that names the failing step. Explain unsupported server types in the setup UI. Support
      several accounts per connector, and suggest a matching connector when a task needs one. Inspiration:
      [Mistral Connectors Debugger](https://mistral.ai/news/more-control-over-connectors/) and
      [Manus connector suggestions](https://manus.im/blog/manus-recommended-connectors).
- [ ] **Run long MCP tool calls as tasks.** Persist MCP task IDs and show them as cards with status,
      mid-run input requests, and cancellation; resume polling after a reload. Today polling lives
      inside one call and fails when a task needs input. Inspiration:
      [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview).
- [ ] **Offer skills served by MCP servers.** List skills from the MCP Skills extension in the skill
      picker with a server badge, and ask again when their file digests change. Inspiration:
      [MCP Skills extension](https://modelcontextprotocol.io/extensions/skills/overview).
- [ ] **Extend MCP Apps.** Support tools registered by an app and app sampling requests. Add
      placements beyond inline and fullscreen, such as a side panel and file viewers chosen by
      extension. Inspiration: [ext-apps releases](https://github.com/modelcontextprotocol/ext-apps/releases)
      and [ChatGPT plugin extensions](https://developers.openai.com/plugins/build/extensions).
- [ ] **Add a browser task panel.** Expose the active page, action history, takeover, and stop controls
      for browser tools supplied by a companion or MCP connection. Include a private sign-in form,
      approval before purchases or account changes, and deleting browser data. Inspiration:
      [Manus Browser Operator](https://manus.im/en/blog/manus-browser-operator) and
      [ChatGPT cloud browser](https://learn.chatgpt.com/codex/browser?surface=web).
- [ ] **Add remote agents by URL.** Read an A2A agent card and offer the agent as a mentionable
      sub-agent with task status and returned artifacts. Inspiration:
      [A2A v1.0](https://github.com/a2aproject/A2A/releases/tag/v1.0.0).

## Context, memory, and usage

- [ ] **Inspect the context for a turn.** Show active instructions, retrieved passages, recalled
      notes, and the latest conversation summary. Let users exclude individual context items from the
      next request and distinguish estimates from measured token usage. Add a context gauge by category
      with cache hits and warn before an action resets the prompt cache. Inspiration:
      [LibreChat v0.8.7](https://github.com/LibreChat-AI/LibreChat/releases/tag/v0.8.7) and
      [Mistral knowledge base](https://docs.mistral.ai/vibe/work/knowledge).
- [ ] **Review automatic memory proposals.** Offer a review mode for accepting, editing, or rejecting
      learned notes before they are saved, with links to the messages that support them. Use the same
      review for proposed changes to an agent's instructions, files, and skills. Inspiration:
      [Manus self-updating projects](https://manus.im/blog/manus-projects-self-updating).
- [ ] **Add memory privacy controls.** Skip sensitive topics unless enabled, show a notice when one is
      saved, never store ID or account numbers, and let users suppress a fact without deleting it. Inspiration:
      [Claude memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
      and [ChatGPT memory](https://help.openai.com/en/articles/8590148-memory-faq).
- [ ] **Summarize usage across work.** Aggregate recorded usage by conversation, agent, and project,
      including nested runs. Show costs only when pricing is configured and preserve unknown values. Add
      a personal dashboard and a monthly recap that suggests turning repeated work into skills or
      projects. Inspiration: [Claude monthly recap](https://support.claude.com/en/articles/15672559-see-your-monthly-recap).

## Background work and automation

- [ ] **Keep runs alive after the tab closes.** Add optional server execution with durable status,
      cancellation, result retrieval, and explicit support for tools that can run outside the browser.
      Show step states and output files in a work panel, notify when a run finishes or needs input, and
      allow steering from another device. Inspiration:
      [Claude chat and tasks](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude)
      and [Gemini Tasks](https://support.google.com/gemini/answer/17094507).
- [ ] **Add persistent goals.** Save the objective, progress, remaining work, and time/token limits;
      let users pause, resume, or steer the run without restating the task. Let a named agent own several
      responsibilities with a check-in cadence, an end date, and "only notify me when" rules, and show
      its status and a log of past and planned actions. Inspiration:
      [ChatGPT dots](https://learn.chatgpt.com/codex/dots) and
      [Grok Bot](https://x.ai/news/introducing-grok-bot).
- [ ] **Schedule one-time and recurring work.** Include timezone, next run, pause, run-now, and run
      history. Create schedules from a chat or an earlier prompt, choose whether a run continues the
      same thread or starts a fresh one, retry failed runs, and set an approval mode per schedule.
      Inspiration: [Claude scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)
      and [Manus Scheduled Tasks](https://manus.im/blog/manus-schedules).
- [ ] **Trigger work from connected-app events.** Support filtered events such as incoming email or
      changed documents, with duplicate-event handling and per-run limits. Merge events that arrive
      together into one run and pause for review before consequential actions. Inspiration:
      [ChatGPT automations](https://learn.chatgpt.com/codex/automations?surface=web),
      [MCP events in ChatGPT](https://developers.openai.com/plugins/build/mcp-events), and
      [Grok Automations](https://x.ai/news/grok-automations).
- [ ] **Add a task inbox.** Collect running jobs, requests for input, failures, and completed results
      across conversations, with links back to the work. Mark chats unread when a run finishes, and
      deliver notifications by browser push, email, or webhook, optionally only when the user is away.
      Inspiration: [Open WebUI 0.11.0](https://github.com/open-webui/open-webui/releases/tag/v0.11.0).
- [ ] **Offer an opt-in daily brief.** Summarize selected projects, connected-app updates, and open
      follow-ups on a chosen schedule, with links to the underlying evidence. Prepare drafts for review,
      and use feedback on each item to tune later briefs. Inspiration:
      [Gemini Daily Brief](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/)
      and [Copilot Today](https://blogs.microsoft.com/blog/2026/09/25/introducing-the-new-copilot-with-home-code-and-autopilot/).

## Sharing and continuity

- [ ] **Sync across devices.** Add optional authenticated sync for chats, files, projects, skills, and
      memory, with upload status, deletion propagation, and conflict handling. Keep local-only operation.
- [ ] **Share chats and responses.** Extend the artifact share on `feature/share` to a chat or a single
      response. Recipients who reply get their own copy. List shared links in settings with a stop
      action, remove them when the chat is deleted, and exclude tool inputs. Inspiration:
      [Copilot shared conversations](https://support.microsoft.com/microsoft-365-copilot/share-conversations-responses-in-microsoft-copilot).
- [ ] **Chat together with the assistant.** Let several people write in one chat, with the assistant
      answering when mentioned and no personal memory used. Show who is present. Inspiration:
      [Open WebUI 0.12.3](https://github.com/open-webui/open-webui/releases/tag/v0.12.3).
- [ ] **Collaborate on shared work.** Add project membership, comments, and shared artifact editing,
      keeping private conversations and personal memory separate from team context. Keep version
      history with attribution, and let a comment that mentions the assistant propose an edit.
      Inspiration: [ChatGPT Space](https://learn.chatgpt.com/codex/space/collaboration),
      [Perplexity shared workspaces](https://www.perplexity.ai/hub/blog/building-shared-workspaces-for-people-and-agents),
      and [Grok Team Bots](https://x.ai/news/team-bots).
- [ ] **Import from other assistants.** Import ChatGPT and Claude export archives as searchable chats
      that can be continued. Import memories as a short list that users review before saving.
      Inspiration: [Gemini import](https://blog.google/innovation-and-ai/products/gemini-app/switch-to-gemini-app/).

## Administration

- [ ] **Filter sensitive data before sending.** Detect personal data such as card or ID numbers in
      messages and attachments, then warn, redact, or block according to deployment policy, and log
      matches for audit. Builds on chat classification and consent prompts. Inspiration:
      [LibreChat v0.8.7-rc1](https://github.com/LibreChat-AI/LibreChat/releases/tag/v0.8.7-rc1).
- [ ] **Enforce usage budgets.** Set token or cost limits per user, group, model, or agent and period,
      and show the remaining allowance. Enforce them in the gateway or proxy. Inspiration:
      [LibreChat v0.8.8](https://github.com/LibreChat-AI/LibreChat/releases/tag/v0.8.8).
- [ ] **Add a trash for deleted work.** Keep deleted chats, agents, and skills restorable for a period,
      with undo after deleting. Inspiration:
      [LobeHub v2.2.19](https://github.com/lobehub/lobehub/releases/tag/v2.2.19).
