# Research benchmarks

The parent sees one `web_research` tool with `prompt` and `mode: fast | deep`.
Fast mode makes one search and returns excerpts without a child model. Deep mode
uses the configured gateway researcher; when none is configured, it runs a local
agent with internal `web_search` and `web_fetch` tools. This keeps retrieval and
follow-up work behind one approval per invocation. A parent can still invoke the
tool again, which requires another approval; this is not a once-per-turn guarantee.

`internet.model` selects the local research model, falling back to the parent model.
The development config uses `gpt-6-luna`. `internet.researcher` takes precedence for
deep mode, and its model is selected in the gateway configuration. A researcher-only
setup exposes deep mode; a scraper-only setup can read supplied URLs. Fast mode is
available only with a searcher. No retrieval configuration means no internet tool.
The gateway's development `researchers.web` also now uses `gpt-6-luna` with low
effort, ordinary search and page fetch. Fast mode still uses no research model.

`internet.elicitation` controls approval. The separate `internet.guard` selects the
gateway content checker, called on the submitted brief before any retrieval or
research request. An omitted selector uses the default gateway guards; without any
configured guards, the check passes. Guard failures block the task. The original
brief is checked once per invocation, not once per internal query.

## Run the benchmark

```sh
# Offline: replay fixed tool requests against synthetic evidence
npm run bench:research

# Real gateway model, fixed synthetic search/fetch responses
npm run bench:research:model -- --repeats 3 --output test-results/research-model.json

# Real model AND localhost:4242 search/extraction endpoints
npm run bench:research:web -- --repeats 2 --output test-results/research-web.json

# Select a model, variant or cases
npm run bench:research:model -- --model claude-sonnet-4-6 --variant current --cases long-page,multi-hop

# Run your own live-web question set
npm run bench:research:web -- --dataset /path/to/questions.json

# End-to-end: parent + fast search, local deep research, gateway delegation,
# and the gateway research endpoint alone. Requires a type: agent researcher.
npm run bench:research:latency -- --repeats 2
npm run bench:research:latency -- --paths chat-fast,chat-deep --research-model gpt-6-luna
```

The gateway harness uses `WINGMAN_E2E_GATEWAY`, then `WINGMAN_URL`, then
`http://localhost:4242`; authentication uses `WINGMAN_TOKEN`. Live modes make paid
model requests. Web mode additionally uses searcher/scraper `web`, overridable
with `--searcher` and `--scraper`. The production client and agent loop are used.
`/api/v1/search` and `/api/v1/extract` go through the dev proxy to the gateway's
`/v1/search` and `/v1/extract` endpoints.

The default model is `gpt-5.4-mini`, at low effort, with 2,048 output tokens per
turn, a ten-turn limit and a 120-second timeout per case. These settings favor a
small, inexpensive regression suite. They do not reproduce a published benchmark's
model, effort or budget. Research runs are measured directly, without the outer
parent's delegation/synthesis or guard/approval requests. The separate latency
harness covers the parent and guard path; provider tests cover approval and resume.

Each custom JSON case needs this shape (fixed/replay modes additionally need
`searches`, `pages`, and, for replay, `calls`; see the bundled fixtures):

```json
[
  {
    "id": "example",
    "question": "A question with precisely specified answer items",
    "expected": [{ "answer": "Expected item", "sources": [] }]
  }
]
```

Gold answers never enter the model prompt. An empty gold set represents
abstention. Empty `sources` permits any retrieved URL; otherwise all listed gold
sources must be cited for citation credit. This exact-item grader is suitable for
controlled factual questions, not general prose. Larger public datasets need
their own answer normalization or a fixed semantic grader.

## What is measured

| Metric                           | Meaning                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tool calls                       | Individual model calls to search/fetch, including cached requests                                              |
| Network requests                 | Calls to the client's search/scrape methods; one batch can contain several                                     |
| Model calls                      | Agent iterations, independently of tool calls                                                                  |
| Result characters                | Tool output added to the transcript, including repeated cached reads                                           |
| Input/output/cached input tokens | Gateway usage; input includes cached input, so this is not a dollar-cost estimate                              |
| Answer F1                        | Macro average of exact normalized answer-set F1; extras and omissions are penalized                            |
| Citation recall                  | Correct items citing the required retrieved URLs; checks provenance coverage, not semantic entailment          |
| Literal evidence recall          | Gold strings appearing in tool output; useful for fixed fixtures, unreliable for differently worded live pages |
| Elapsed time                     | Per-case wall time, including tools and model work                                                             |

The JSON output preserves answers, tool arguments, returned evidence, failures,
and per-case metrics. Failed/interrupted runs receive zero answer credit. Runs
reaching the turn limit are flagged. Repetitions alternate the variant order;
live-web results can still vary due to ranking, caches, content and model sampling.

The baseline tool schemas, behavior and prompt are frozen from `fa3d5e82` in
`tests/e2e/fixtures/research-baseline.ts`. Both variants use the same backend within
a run. Changing the backend changes both variants: keep reports from before and
after a restart separate.

## Measurements on 2026-10-03

The eight fixed cases cover a fact lookup, comparison, multi-step lookup, evidence
late in a long document, dated conflicting evidence, partial failures, abstention,
and retrieved instructions. Three repetitions give 24 observations per variant.

| Fixed evidence, real model | Baseline | Optimized |
| -------------------------- | -------: | --------: |
| Tool calls                 |       91 |        44 |
| Retrieval requests         |      156 |        69 |
| Model calls                |       92 |        64 |
| Input tokens               |   84,942 |    51,619 |
| Output tokens              |    6,929 |     4,042 |
| Returned characters        |   52,308 |    31,061 |
| Answer F1                  |    0.708 |     1.000 |
| Citation recall            |    0.708 |     0.917 |
| Total wall time            |  102.8 s |    57.4 s |

This is 52% fewer tool calls and 39% fewer input tokens. Citation coverage remains
imperfect: two optimized multi-step answers omitted an intermediate source.

The first live-web comparison used three questions, each repeated twice, against
the original backend. Tool calls fell from 29 to 18; retrieval requests from 47 to
16; input tokens from 401,913 to 77,084; answer F1 rose from 0.667 to 1.000.
Two baseline paper-reading runs reached the ten-turn limit. A difficult page
revealed a caption-versus-heading ranking issue; the final local excerpt selector
now weights distinctive words, exact phrases and matching section headings.

After restarting the gateway with the local Exa excerpt changes, the final live
comparison (three questions × two repetitions, same updated backend for both
frontend variants) measured:

| Live web, updated backend    | Baseline frontend | Final frontend |
| ---------------------------- | ----------------: | -------------: |
| Tool calls                   |                19 |             11 |
| Retrieval requests           |                28 |             16 |
| Model calls                  |                23 |             16 |
| Input tokens                 |           207,749 |         42,536 |
| Output tokens                |             2,620 |          1,495 |
| Returned characters          |           290,959 |        102,909 |
| Answer F1 / citation recall  |     0.833 / 0.833 |  1.000 / 1.000 |
| Runs reaching the turn limit |                 1 |              0 |
| Total wall time              |            61.8 s |         29.4 s |

That is 42% fewer tool calls and 80% fewer input tokens in this small live run.
The large token difference includes one baseline run exhausting its turn budget.
Gateway transcripts confirmed the new excerpt marker and publication metadata.

Offline replay of the final tools keeps the same ten scripted tool calls, reduces
retrieval requests from 14 to 11 and result characters from 13,601 to 3,000, and
recovers all gold evidence, including the passage beyond 12,000 characters.
This is a deterministic tool check, not a model-quality measurement.

Machine-readable measurements are in [research-benchmark-results.json](research-benchmark-results.json).
Full local transcripts remain in the ignored `test-results/` directory.

## Gateway agent and end-to-end latency

The gateway's `pkg/researcher/agent` has a separate opt-in, fixed-evidence benchmark:

```sh
cd ../wingman
RESEARCH_BENCHMARK=1 RESEARCH_BENCHMARK_REPEATS=2 \
  RESEARCH_BENCHMARK_OUTPUT=/tmp/research-agent.json \
  go test -run '^TestResearchFixedBenchmark$' -count=1 -v ./pkg/researcher/agent
```

It uses `gpt-5.4-mini` at low effort through `http://localhost:4242/v1/` by default.
Override `RESEARCH_BENCHMARK_URL`, `RESEARCH_BENCHMARK_MODEL`, and
`RESEARCH_BENCHMARK_TOKEN` as needed. Search and page evidence are fixed, so this
test makes model requests but no external retrieval requests. Its narrow literal
answer-recall grader does not penalize all extra claims or measure entailment.

Nine cases, repeated twice, compared gateway revision `056cf71` with the optimized
agent before the final scheduling review:

| Fixed evidence, gateway agent |     Baseline |   Optimized |
| ----------------------------- | -----------: | ----------: |
| Tool / retrieval calls        |           57 |          32 |
| Model calls                   |           56 |          45 |
| Input tokens                  |       77,138 |      40,189 |
| Tool result characters        |       56,484 |       7,928 |
| Total elapsed time            |       73.0 s |      48.1 s |
| Median / maximum              | 3.8 / 10.0 s | 2.3 / 5.0 s |
| Literal answer recall         |        1.000 |       1.000 |
| Citation coverage             |        0.611 |       0.667 |

The runs were sequential before/after tests on a development set. Model sampling
and caches affect the comparison. Citation coverage still needs improvement.

The live latency harness exercises four historical factual questions twice. Its
timer includes request submission, guard, parent model, retrieval/research, and
parent synthesis, but excludes browser rendering and human approval time. Parent
model is `gpt-5.4-mini` at low effort; local deep research uses `gpt-6-luna` with its
default settings. The gateway researcher also used `gpt-5.4-mini` at low effort for
these measurements, before the later switch to Luna. The endpoint-only gateway measurements omit the parent and
guard, so they are not directly comparable to full chat latency.

| Earlier live run                          | Runs | Median | Maximum | Answer F1 |
| ----------------------------------------- | ---: | -----: | ------: | --------: |
| Chat fast, simple questions               |    4 |  3.2 s |   4.8 s |     0.750 |
| Chat local deep (Luna), simple questions  |    4 |  5.8 s |   7.6 s |     1.000 |
| Chat local deep (Luna), complex questions |    4 |  9.4 s |  12.0 s |     1.000 |
| Gateway endpoint, simple questions        |    4 |  3.6 s |   5.0 s |     1.000 |
| Gateway endpoint, complex questions       |    4 |  6.6 s |  18.8 s |     1.000 |

One fast run abstained because its search did not supply sufficient evidence; one
also retried the top-level tool. The reviewed schema now asks for a concise search
query in fast mode, keeping output-format instructions in the parent conversation.
These earlier results remain recorded rather than being replaced by later runs.
The precise paper corpus count, 18.42777 million, and its correctly rounded forms
are explicit gold aliases for the 18.4 million figure, not a general numeric tolerance.

After the routing and scheduling review and gateway restart, 28 live requests
completed without transport errors. Each chat run invoked the top-level tool and
guard exactly once; each `chat-gateway` run made one research request and no local
child-model call. The corrected answer grader accepts `18.43 million` and an extra
trailing zero in the exact count. Original scores are retained in the snapshot.

| Reviewed live run                         | Runs | Median | Maximum | Answer F1 |
| ----------------------------------------- | ---: | -----: | ------: | --------: |
| Chat fast, simple questions               |    4 |  2.3 s |   4.2 s |     0.750 |
| Chat local deep (Luna), simple questions  |    4 |  6.4 s |  13.3 s |     1.000 |
| Chat local deep (Luna), complex questions |    4 |  7.0 s |  10.8 s |     1.000 |
| Chat gateway deep, simple questions       |    4 |  7.9 s |  11.1 s |     1.000 |
| Chat gateway deep, complex questions      |    4 |  8.9 s |  17.9 s |     1.000 |
| Gateway endpoint, simple questions        |    4 |  3.4 s |   4.8 s |     1.000 |
| Gateway endpoint, complex questions       |    4 |  4.0 s |   9.9 s |     1.000 |

The fast miss was an abstention, not a fabricated answer. Fast mode's one search
cannot guarantee enough evidence for every question. Local deep answered all eight
questions correctly; the gateway paths did too after correcting numeric grading.
These are routing/latency smoke checks, not evidence that either model is generally
more accurate or faster. The timing order alternates between repetitions.

The citation grader now accepts a section fragment on a retrieved document while
rejecting different paths, queries and lookalike hostnames. The reviewed run did
not retain the observed URL list, so its original citation scores were preserved
rather than retrospectively granting credit. Future latency reports retain evidence
and request inputs to support grading audits.

A separate smoke check with the configured `claude-sonnet-5` parent returned correct
answers: one fast lookup took 4.5 seconds and a page-reading task delegated through
the gateway took 8.0 seconds. On another simple question the parent chose fast mode
despite the benchmark requesting deep. That 4.3-second result is not a gateway-deep
measurement. The harness now records actual execution strategies and fails a run
that does not exercise its requested route, independently of answer correctness.

The subsequent gateway speed review compared 18 fixed-evidence runs per variant
on the same `gpt-5.4-mini` model. Tool calls fell 31→30, input tokens 42,499→41,640,
output tokens 3,179→2,981, and median latency 2.23→1.76 seconds. Total latency rose
43.41→44.64 seconds because of a slower multi-hop run, so this does **not** establish
an overall speed gain. The original baseline abstention score missed a curly
apostrophe; the underlying answer correctly abstained. Raw scores are retained.

This review replaces repeated large tool results with references to their first
full result, keeping original evidence and citations in the transcript. A repeated
evidence regression reduces three copies from 6,405 to 2,315 characters (64%).
Short results, errors and changed evidence remain intact. Inline citations remain
required; a duplicate final sources list is now optional unless requested.

After installing that patch and switching the gateway to `gpt-6-luna` at low effort,
a final live smoke run covered all four questions once through each applicable path:

| Final Luna deployment  | Runs | Median | Maximum |
| ---------------------- | ---: | -----: | ------: |
| Chat fast              |    2 |  3.0 s |   3.7 s |
| Chat local deep        |    4 |  9.2 s |  10.9 s |
| Chat gateway deep      |    4 |  8.6 s |  10.7 s |
| Gateway endpoint alone |    4 |  4.8 s |   7.2 s |

All 14 answers passed the corrected exact-item grader, all routes matched their
requested strategy, and no requests failed. Every chat task made one top-level
research invocation and one guard check. Parent model remained `gpt-5.4-mini` for
controlled comparison; both deep researchers used Luna. These two-to-four samples
per path verify the final wiring, not a latency guarantee or a general quality
score. Earlier fast-search abstentions remain in the report.

`chat-gateway` measures the full configured-researcher path including its parent
and guard. The HTTP research endpoint exposes no internal evidence trace or usage,
so its retrieval counts and citation recall are unknown; chat-gateway model counts
cover only its parent. Reports distinguish these missing values from zero.

The gateway review keeps a 20-tool-call cap, four concurrent workers, bounded
per-run retrieval caches, 6,000-character page defaults and an 80 Ki-character total
fetch budget. Worker scheduling now consumes a shared queue, while output order and
budget accounting remain deterministic. Short results and failures leave unused
budget available to later batches. Focused page reads use local verbatim passage
selection; small budgets no longer scan almost every character as a new window.
Chat additionally bounds fast work to 15 seconds and deep work to 120 seconds
(12 model iterations for the local agent), starting after approval.

Gateway and latency snapshots are in
[research-agent-benchmark-results.json](research-agent-benchmark-results.json).

These are small development/smoke sets used while tuning the implementation,
not held-out evaluations or AgentWebBench/DeepSearchQA/BrowseComp scores. The live
set contains two questions about the same paper. Improvements on long pages account
for much of the token reduction. Broader models and unseen tasks can behave differently.

## Implementation and Exa boundary

Frontend requests are deduplicated, batched up to eight, and limited to four
concurrent requests per batch. Successful requests are cached only within one
agent run (its cancellation signal), with bounded entry count and retained result
size. Errors and empty responses are retried normally. Cancellation stops queued
work. Fetch supports keyword-selected verbatim excerpts, character offsets and
an adjustable output budget. Excerpt labels explicitly identify omitted content.

The sibling Wingman Exa search provider continues to request `type: fast` and
`contents: {text: true}`. It chooses a roughly 1,400-character passage locally,
marks the output as an excerpt, and preserves publication dates through API
metadata. Full document reading uses the existing scraper. The search provider
rejects deep/synthesis modes. No highlights, summaries, `outputSchema` or Exa
research endpoint is used by this path. Exa still receives the search query or
requested URL, as required for retrieval.

Two direct provider smoke tests retained their checked answer strings while
reducing returned content from 185,755 to 4,110 characters and from 12,560 to 4,317.
This saves downstream gateway payload; Exa still returns full text to Wingman.
The provider tests can be rerun in `../wingman`:

```sh
go test -race ./pkg/searcher/... ./pkg/tool/search ./pkg/scraper/exa
EXA_LIVE_TEST=1 go test -run TestSearchLive -count=1 -v ./pkg/searcher/exa
# The opt-in live test also requires EXA_API_KEY in the environment.
```

The evaluation design borrows quality-versus-interaction accounting from
[AgentWebBench](https://arxiv.org/html/2604.10938v1) and result/context accounting
from the [Claude agentic-search cookbook](https://platform.claude.com/cookbook/evals-agentic-search-reproduce-agentic-search-benchmarks).
Those systems' architecture and budgets are different. Exa's
[search documentation](https://exa.ai/docs/search/quickstart) distinguishes ordinary
retrieval from deep modes and synthesized output; this implementation retains
ordinary retrieval and performs passage selection itself.
