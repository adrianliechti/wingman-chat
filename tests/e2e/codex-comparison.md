# File-editing correctness comparison

## Result

On 2026-09-04, Wingman and the official Codex CLI both passed all eight independent checks on the same returns-policy rollout fixture.

| Observed result                           | Wingman shared file tools |              Official Codex CLI 0.153.2 |
| ----------------------------------------- | ------------------------: | --------------------------------------: |
| Outcome checks                            |                       8/8 |                                     8/8 |
| Requested model / reasoning               |          gpt-5.4 / medium |                        gpt-5.4 / medium |
| Elapsed time                              |            33.031 seconds |                          66.263 seconds |
| Operations                                |        17 file-tool calls | 14 shell commands + 1 file-change event |
| Input tokens, accumulated across requests |                    26,397 |                                  98,558 |
| Cached input tokens                       |                    15,872 |                                  85,760 |
| Output tokens                             |                     2,673 |                                   3,028 |

This is one representative synthetic example, not a quality ranking or controlled latency benchmark. Different system instructions, request counts, cache states, backends and tool capabilities affect timing and token usage. The same requested model ID does not establish an identical backend deployment. One Codex command (`git diff --name-only`) failed because the isolated document workspace was not a Git repository; Codex recovered and the final files passed all checks. Do not interpret that harness difference as a tool-quality failure.

The complete run data and file snapshots are retained locally in [report.json](/private/var/folders/32/bg4hkw7571b0zzj3_dzsp7y40000gn/T/wingman-codex-comparison-gegjjr/report.json), [wingman.json](/private/var/folders/32/bg4hkw7571b0zzj3_dzsp7y40000gn/T/wingman-codex-comparison-gegjjr/wingman.json), and [codex.json](/private/var/folders/32/bg4hkw7571b0zzj3_dzsp7y40000gn/T/wingman-codex-comparison-gegjjr/codex.json). Disposable workspaces were removed after taking these snapshots; no project/user files were deleted by the comparison.

## Follow-up: glob and format feedback (2026-09-05)

The same Wingman fixture, requested `gpt-5.4` model, and medium reasoning setting were rerun after the prompt cleanup and after the tool fixes:

| Wingman run                    | Tool calls | Model requests |  Elapsed | Outcome checks |
| ------------------------------ | ---------: | -------------: | -------: | -------------: |
| Original baseline              |         17 |              8 | 33.031 s |            8/8 |
| Prompt cleanup only            |         24 |              8 | 33.824 s |            8/8 |
| Glob and format-feedback fixes |         10 |              4 | 20.797 s |            8/8 |

The prompt-only trace exposed a glob bug: wildcards inside brace alternatives could invalidate the entire match, causing six fallback listings. It also contained two rejected `n` arguments and ineffective BOM/CRLF searches against normalized text. The fixes support nested wildcard alternatives in both file spaces, expose actual text-format metadata in read/create/edit results, and suggest declared hyphenated flags without accepting aliases. Regression tests cover these behaviors; Chromium checks confirm that the reported format agrees with real OPFS content.

The latest Wingman run made five initial reads, one atomic four-file edit/create batch, and four verification reads, with no tool errors. It used 12,295 accumulated input tokens (6,656 cached) and 1,430 output tokens. It did not call glob or grep, so this trace does not directly exercise those fixes or isolate their effect on efficiency. Each row is one observation, not a controlled estimate of an average improvement.

Latest results and snapshots: [report.json](/private/var/folders/32/bg4hkw7571b0zzj3_dzsp7y40000gn/T/wingman-codex-comparison-dGU1LC/report.json), [wingman.json](/private/var/folders/32/bg4hkw7571b0zzj3_dzsp7y40000gn/T/wingman-codex-comparison-dGU1LC/wingman.json). The official Codex half failed before task execution with `The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.` This makes the paired command exit nonzero; its unchanged fixture is not a Codex correctness result. No model or authentication settings were changed to bypass the failure.

## Scenario and checks

Both agents receive the exact same task: update EU/US return windows across Markdown, JSON and HTML, preserve warranty/exclusion rules, create a rollout JSON file, and leave archived policy and an SVG unchanged. The independent grader checks:

1. Policy text is exactly the intended change.
2. The policy retains its UTF-8 BOM.
3. The policy retains CRLF line endings.
4. Configuration has the required values and unchanged fields.
5. Customer-facing HTML has the updated windows and warranty.
6. The new rollout JSON has exactly the required data.
7. Archived content and the SVG remain byte-for-byte unchanged.
8. There are no missing or extra files.

The grader reads resulting files; it does not trust either agent's final answer. Its own tests verify that encoding loss, collateral edits, extra files and incorrect JSON fail the checks.

## Scope and reproducibility

Wingman uses the actual shared `createFileTools` schemas/handlers and chat/artifact prompts over the existing disk-backed test adapter. This compares the file-tool contract and model loop, not the React UI, OPFS coordinator, repository search or interpreter. Those are verified separately by regression and browser tests. Codex uses its native shell/edit tools. No task data is private, and the prompt prohibits network access, dependency installation and delegation.

The official run uses `codex exec --json --ephemeral --ignore-user-config --ignore-rules --sandbox workspace-write --skip-git-repo-check`, as described in [OpenAI's non-interactive-mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode). Authentication uses the existing CLI setup. The harness explicitly closes unused stdin: an initial harness attempt left that pipe open, so Codex waited without starting. That timeout is excluded from the comparison above. Wingman passed 8/8 on that preliminary attempt too.

Run the deterministic grader without model access:

```sh
npm run test:compare:grader
```

Run a fresh paired comparison (requires a running Wingman gateway and authenticated official Codex CLI; makes real model calls):

```sh
npm run test:compare:codex
```

Optional overrides: `WINGMAN_COMPARE_MODEL` selects the same requested model for both agents; `WINGMAN_COMPARE_CODEX` selects the CLI binary; the existing `WINGMAN_E2E_GATEWAY`/`WINGMAN_URL` settings select the gateway. Each run prints a fresh temporary report directory. An incomplete execution or failed outcome check returns a nonzero exit code.

## Additional correctness pass

- Tool calls and finish-time artifact verification are bound to their originating `chatId`, including draft chats and child calls; selecting another chat no longer redirects workspace operations. Voice transcripts/results also target their original conversation.
- Child observations now use a weak map keyed by the existing invocation object. Child activity cannot evict the main conversation's freshness baseline; no new file-session identifier is needed. Main conversation metadata retains a bounded 64-conversation LRU.
- OPFS reads preserve UTF-8 BOMs instead of stripping them through `Blob.text()`. A real browser test covers create → edit → reread with BOM/CRLF and storage-inferred MIME types.
- A no-op write with an omitted MIME type no longer reports an update. Semantic search excludes stale chunks from pending/failed/unreadable documents.
- Voice stop aborts active tool work and ignores late responses; stopping during audio initialization cannot create a zombie socket. Static session comparison now uses the actual schemas and helper model, replacing a custom hash that only considered tool names.

Verification after this pass: **294 unit tests**, **2 grader tests**, **10 Chromium runs** (five tests repeated twice), **6 live gateway tests**, production build and all **90 skill validations** passed. Type/lint checks passed without warnings. Full formatting checks still flag eight untouched pre-existing files. Voice lifecycle tests mock audio and WebSocket transport; a live audio session was not exercised.
