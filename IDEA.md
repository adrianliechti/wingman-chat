# Wingman Chat TODO

Reviewed against the codebase and official product updates on 2026-10-02. Open items only.
Linked features are inspiration for Wingman; provider and gateway support must be checked separately.

## Conversations

- [ ] **Save composer drafts.** Preserve unsent text and attachments per conversation, including a
      new-chat draft, across navigation and reloads. Clear the draft after a successful send.
- [ ] **Handle large pastes.** Offer to turn a long paste into a named text attachment, with a preview
      and an option to move it back into the composer.
- [ ] **Open search results at the matching message.** Show excerpts, highlight matches, and jump to
      the relevant passage instead of opening the conversation at its latest message.
- [ ] **Expand search.** Add date and model filters, artifact names and extracted file text, and an
      incremental local search index for large histories.
- [ ] **Branch from a selected message.** Copy history up to that point and the referenced artifact
      revisions. Show parent and sibling links so branches can be revisited independently.
- [ ] **Add temporary conversations.** Keep the chat, drafts, and artifacts out of saved history and
      disable memory recall and learning. Offer an explicit save action before leaving.
- [ ] **Compare models side by side.** Run the same prompt and context snapshot through two selected
      models, show available latency and usage, and continue from either answer in its own conversation.
      Start with text-only comparisons and keep each run's history and artifacts separate.

## Projects and reusable files

- [ ] **Group work into projects.** Keep related chats, instructions, files, and agent choices together;
      allow moving existing chats between projects. Inspiration:
      [ChatGPT Space and shared work](https://learn.chatgpt.com/docs/whats-new).
- [ ] **Scope context to a project.** Share retrieval and memory across its conversations, with an
      explicit choice to include personal context from outside the project.
- [ ] **Add a reusable file library.** Save artifacts to a searchable, tagged library and attach them
      to another chat. Retain the source conversation and revision; distinguish a fixed copy from a file
      that follows updates to its source.

## Artifacts and media

- [ ] **Allow manual artifact editing.** Type changes directly into Markdown, text, and code files
      beside the chat, with save/cancel controls and revisions. Inspiration:
      [Claude's document and artifact editing](https://support.claude.com/en/articles/12138966-release-notes).
- [ ] **Review proposed AI edits before applying them.** Extend selection-based change requests with
      a proposed diff and accept/discard controls, including protection against overwriting newer edits.
- [ ] **Annotate images and screenshots.** Mark a region, add an instruction, and send the annotation
      with the original image. Group related variants for comparison; offer masks when supported.
- [ ] **Turn recordings into traceable meeting notes.** Keep an editable, timestamped transcript and
      link decisions and action items to playback positions. Include speaker labels when the provider
      supplies them.
- [ ] **Answer questions about video with timestamps.** Inspect visual segments as well as audio,
      and link answers to the relevant moments. Inspiration:
      [Gemini video understanding](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-agentic-video-in-gemini/).
- [ ] **Generate video through supported providers.** Accept text and image references, show job
      progress and cancellation, and save clips as artifacts. Inspiration:
      [Grok Imagine video references](https://x.ai/news/grok-imagine-video-1-5-references).

## Research

- [ ] **Make research steerable.** Let users edit a research brief, choose web and document sources,
      set domain/date filters, and adjust the brief while reviewing progress.
- [ ] **Add an evidence panel.** Open citations beside the report at their supporting passages,
      retain retrieval times, surface conflicting evidence, and allow excluding individual sources.
- [ ] **Research lists of items in parallel.** Turn a list of companies, products, or documents into
      a comparison table with per-item progress, sources, retry controls, and a shared execution budget.
      Build on existing sub-agents. Inspiration: [Manus Wide Research](https://manus.im/blog/introducing-wide-research).
- [ ] **Refresh saved research.** Recheck a report's sources, highlight changed findings, and update
      the same artifact while retaining the previous version.

## Skills and connected apps

- [ ] **Add composer shortcuts for skills and context.** Provide `/skill` autocomplete and `@`
      mentions for files and connected apps, with visible selections for the current request. Inspiration:
      [Gemini skills](https://blog.google/products-and-platforms/products/gemini/automate-tasks-with-skills/)
      and [connected apps](https://blog.google/innovation-and-ai/products/gemini-app/new-connected-apps-gemini/).
- [ ] **Give saved workflows a run form.** Extend the skill builder with a conversation-to-workflow
      action, reviewed instructions, named inputs, file slots, and an example output. Start each run in a
      fresh conversation with the chosen agent.
- [ ] **Connect a plugin's declared tools.** Turn compatible MCP server declarations into reviewed
      connection setup, show missing dependencies and connected accounts, and provide a connection test.
      Explain unsupported server types in the setup UI.
- [ ] **Add a browser task panel.** Expose the active page, action history, takeover, and stop controls
      for browser tools supplied by a companion or MCP connection. Inspiration:
      [Manus Browser Operator](https://manus.im/en/blog/manus-browser-operator).

## Context, memory, and usage

- [ ] **Inspect the context for a turn.** Show active instructions, retrieved passages, recalled
      notes, and the latest conversation summary. Let users exclude individual context items from the
      next request and distinguish estimates from measured token usage.
- [ ] **Review automatic memory proposals.** Offer a review mode for accepting, editing, or rejecting
      learned notes before they are saved, with links to the messages that support them.
- [ ] **Summarize usage across work.** Aggregate recorded usage by conversation, agent, and project,
      including nested runs. Show costs only when pricing is configured and preserve unknown values.

## Background work and automation

- [ ] **Keep runs alive after the tab closes.** Add optional server execution with durable status,
      cancellation, result retrieval, and explicit support for tools that can run outside the browser.
- [ ] **Add persistent goals.** Save the objective, progress, remaining work, and time/token limits;
      let users pause, resume, or steer the run without restating the task. Inspiration:
      [ChatGPT ongoing work](https://learn.chatgpt.com/docs/whats-new) and
      [Grok's persistent agents](https://x.ai/news/designing-grok-bot).
- [ ] **Schedule one-time and recurring work.** Include timezone, next run, pause, run-now, and run
      history. Let a schedule update an existing report or start a fresh conversation. Inspiration:
      [Manus Scheduled Tasks](https://manus.im/blog/manus-schedules).
- [ ] **Trigger work from connected-app events.** Support filtered events such as incoming email or
      changed documents, with duplicate-event handling and per-run limits. Inspiration:
      [Grok Automations](https://x.ai/news/grok-automations).
- [ ] **Add a task inbox.** Collect running jobs, requests for input, failures, and completed results
      across conversations, with links back to the work and optional completion notifications.
- [ ] **Offer an opt-in daily brief.** Summarize selected projects, connected-app updates, and open
      follow-ups on a chosen schedule, with links to the underlying evidence. Inspiration:
      [Gemini Daily Brief](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/).

## Sharing and continuity

- [ ] **Sync across devices.** Add optional authenticated sync for chats, files, projects, skills, and
      memory, with upload status, deletion propagation, and conflict handling. Keep local-only operation.
- [ ] **Share selected results.** Publish a read-only snapshot of chosen messages and artifacts with
      a recipient preview, access controls, revocation, and a copy-to-chat action.
- [ ] **Collaborate on shared work.** Add project membership, comments, and shared artifact editing,
      keeping private conversations and personal memory separate from team context. Inspiration:
      [ChatGPT Space](https://learn.chatgpt.com/docs/whats-new) and [Grok Team Bots](https://x.ai/news/team-bots).
