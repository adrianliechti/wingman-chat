# Defines the `sql` helper exposed to user code. The query runs in the app's
# DuckDB over the chat's artifact workspace (CSV, TSV, JSON, JSONL and Parquet
# files are queryable by name), bridged via `_wingman_sql` (set as a Pyodide
# global by interpreter.worker.ts). Parameters and the result travel as JSON.
import json as _json


async def sql(query, params=None):
    """Run a DuckDB query over the workspace's data files.

    Files are queryable by name, e.g. SELECT * FROM 'flights.csv' or
    FROM 'data/flights.csv'. Files written during this run become queryable
    in the next run.

    Args:
        query: The SQL text; use $1, $2, … for parameters.
        params: Optional list of parameter values.

    Returns:
        A dict {"columns": [{"name", "type"}], "rows": [dict, ...], "rowCount": int}.
        pandas.DataFrame(result["rows"]) gives a frame.
    """
    encoded = await _wingman_sql(str(query), _json.dumps(list(params)) if params is not None else None)
    return _json.loads(encoded)
