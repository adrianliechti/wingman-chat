# Evaluated once per execution, only when the DuckDB wheel has been loaded.
# Return a cleanup callable retained by the worker, outside user globals.
def _wingman_duckdb_scope():
    import duckdb
    from functools import wraps

    native_connect = duckdb.connect
    connections = []
    finished = False

    @wraps(native_connect)
    def connect(database=":memory:", read_only=False, config=None):
        if finished:
            raise RuntimeError("This DuckDB execution has ended")
        # :default: refers to our already-configured connection, not a new DB.
        settings = (config or {}) if database == ":default:" else {
            "memory_limit": "256MB",
            "threads": 1,
            **(config or {}),
        }
        connection = native_connect(database, read_only=read_only, config=settings)
        connections.append(connection)
        return connection

    def close():
        nonlocal finished
        if finished:
            return
        finished = True
        duckdb.connect = native_connect
        try:
            duckdb.default_connection().close()
        finally:
            # Explicit connections also need closing before the filesystem is
            # collected, so committed database changes are checkpointed.
            for connection in reversed(connections):
                connection.close()

    try:
        duckdb.default_connection().close()
        duckdb.set_default_connection(connect())
        duckdb.connect = connect
    except Exception:
        close()
        raise
    return close


_wingman_duckdb_scope()
