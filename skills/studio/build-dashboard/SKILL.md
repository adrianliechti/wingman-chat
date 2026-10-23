---
name: build-dashboard
description: "Build an interactive HTML dashboard with coordinated metrics, charts, filters and tables from workspace data. Use when several views must respond to the same selection."
---

# Build dashboard

Identify the decision the dashboard supports, available data, metric definitions and useful filters. Read the schema and sample rows before building. Use real observations; if data is missing, request it or create an explicitly requested, clearly labelled sample. Never manufacture trends or prior-period comparisons.

Load `html-artifacts` for the runtime contract:

- Read `references/libraries.md` for ECharts and browser dependencies.
- Read `references/duckdb.md` for workspace SQL; prefer it for runtime aggregation over larger datasets.
- Read `references/sdk.md` only when the page needs saved state, workspace writes, AI or tools.

For a preview, keep data in workspace files and query/load it at runtime. Prepare heavy transformations in Python and save Parquet when useful. For a standalone file, embed only the needed data and use native browser drawing; a bundled library URL or workspace SQL will not survive single-file download.

Use one filter state and one update path for all views. Apply the same date range, categories, null handling and units to KPIs, charts and tables. Compute ratios from aggregated numerators/denominators rather than averaging percentages. Show comparison deltas only for comparable periods with valid baselines.

Choose a layout for the job: a leading conclusion and evidence for executives, status and actionable rows for operations, or persistent filters and drill-down for analysis. Match source branding; use color for meaning and labels/patterns as a second signal.

ECharts instances need containers with explicit height, resize handling and disposal on teardown. Update existing instances with `setOption`; remove obsolete series when filters change. Populate filters from data, distinguish zero from missing, show no-results and query-error states, and prevent stale async responses from replacing newer selections. Paginate large tables and downsample dense plots without hiding relevant extremes.

Verify a filter combination, reset, empty result and table sort; reconcile totals against the source. Check that every view uses the same filtered population. Describe whether the delivered data is a snapshot or refreshable; do not imply live monitoring without a working source.
