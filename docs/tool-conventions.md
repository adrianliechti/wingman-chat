# Tool paths and chat hints

First-party tools use `path` for a single file or folder. Whether it names a target or a search scope comes from the operation, not a different parameter name. This also covers deletion, which accepts both files and folders.

| Operation                                                                             | Path input         | Meaning                                                |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `artifacts_read`, `repository_read`                                                   | `path`             | File to read                                           |
| `artifacts_create`, `artifacts_delete`                                                | `path`             | File to write; file or folder to delete                |
| `artifacts_edit`                                                                      | `edits[].path`     | File for each replacement in the atomic batch          |
| Artifact and repository grep/glob                                                     | `path`             | Search scope; defaults to the entire file space        |
| `execute_script`                                                                      | `path`             | Script to run; nonempty inline `code` takes precedence |
| `artifacts_move`                                                                      | `from`, `to`       | Source and destination of a move or rename             |
| `list_skills`, `read_skill_resource`, `write_skill_resource`, `delete_skill_resource` | `path`             | Resource relative to the selected skill folder         |
| `create_skill`                                                                        | `resources[].path` | Relative path of each bundled resource                 |

Artifact paths, including the persistent `/.memory/` mount, and repository paths are absolute virtual paths in their respective file spaces. Skill resources use relative paths such as `scripts/check.py`. `execute_script` can also select a mounted skill script by its absolute `/skills/...` path. Image references retain `images`, an array of artifact paths. Web tools use URLs rather than filesystem paths.

Published schemas and prompts use the canonical names only. Direct execution and saved-call display still recognize legacy `file_path` and `list_skills.resource` inputs. If both selectors are present, `path` wins; an invalid canonical selector does not silently switch to its alias. Native tool validation uses the published schema. External MCP schemas remain defined by their servers.

## Collapsed hints

Hints identify what the tool is acting on. Full inputs and results remain available in the expanded row. Hints collapse whitespace, omit data URLs, and are limited to 160 characters. Batch hints include the item count and the first two entries.

| Tools                            | Hint                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| File read/create/delete          | Workspace-relative target path                                  |
| Batch edit                       | Distinct filenames, with a file count for multiple targets      |
| Move/rename                      | Source → destination; available selector while arguments stream |
| File grep/glob                   | Search pattern and any explicit path/glob scope                 |
| Memory operations                | Readable note names; search pattern and note scope              |
| Repository semantic search       | Natural-language query                                          |
| Script execution                 | Script path, or Python/JavaScript/Bash for inline code          |
| Web research                     | Research brief                                                  |
| Web search/fetch                 | Queries or URLs, with batch counts                              |
| Image generation/edit            | Image prompt; labels reflect explicit reference-image edits     |
| Structured questions             | Question text, with a count for multiple questions              |
| Skill load/create/update/delete  | Skill name                                                      |
| Skill resource read/write/delete | Skill name and relative resource path                           |
| Personal skill listing           | Selected skill/resource, or no hint when listing the library    |
| Tool discovery                   | Readable tool names, with batch counts                          |
| Delegation and external tools    | Best available identifier, target, query, command, or task text |

Built-in headers explicitly select their hint, including hiding it when identifying arguments have not arrived yet. Streaming file creation therefore never falls back to HTML content. Generic fallback recognizes common path aliases and arrays but does not preview raw `content`, `body`, or `data` payloads. Tools can return `preview: null` to hide the fallback; omitting `preview` opts into it.

## Contracts for the calling model

Tool descriptions, schemas, prompts and execution feedback must agree on the next valid action. Keep schemas closed and union-free for provider compatibility; check conditional requirements in execution when a portable schema cannot express them.

| Situation                               | Contract                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grep returns a partial page             | Follow the returned `skip=N`; content-mode pagination counts matching lines, not surrounding context                                                        |
| Grep cannot search the requested scope  | A missing path is an error; excluded/binary-only files report that no text was searched; a genuine miss reports how many text files were searched           |
| Grep filters by extension               | `type` is an enum of supported aliases; use `glob` for other extensions, including PDF/CSV/TXT                                                              |
| Grep uses `multiline`                   | Whole-file matching with dot matching newlines; `^`/`$` are file boundaries                                                                                 |
| A fetched page may be summarized        | The tool advertises this when configured; use `query` or `offset=0` for verbatim source, and do not quote generated summaries                               |
| Image quality is omitted                | The schema names the same configured default tier used by execution                                                                                         |
| A skill resource path is supplied       | `list_skills` requires `name`; it cannot silently turn the request into a library listing                                                                   |
| Skill resources are read or executed    | Resource reads use a relative path; interpreter execution uses the absolute `/skills/<name>/...` mount                                                      |
| Script selectors are omitted            | The failure asks for `code` with `language`, or a script `path`, without speculating that JSON parsing failed                                               |
| An unsupported package or runtime fails | Recovery must select a bundled alternative or request a rewrite, rather than suggest importing a known unavailable package or executing Ruby/Java in Python |
| The call stack is exhausted             | Diagnose recursion separately from data-memory exhaustion                                                                                                   |

Repository semantic search also labels rank and raw similarity separately. A relevance score is not presented as a confidence percentage, and snippets retain source paths and available line ranges for further reading.

Regression tests exercise these decisions through actual tool calls and returned continuation values. They verify source passages, omitted defaults, search coverage, invalid selectors, and error-class recovery instead of asserting changes in wording alone.
