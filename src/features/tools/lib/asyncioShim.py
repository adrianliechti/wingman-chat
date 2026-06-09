# Pyodide's event loop can only block synchronously (asyncio.run,
# loop.run_until_complete, pyodide.ffi.run_sync) when the JS runtime supports
# WebAssembly stack switching (JSPI) — absent in Safari and not reliably
# enabled elsewhere. runPythonAsync supports top-level await, so two layers
# of defense (installed by interpreter.worker.ts):
#   1. `_wingman_rewrite_async` rewrites blocking entrypoints at module level
#      into top-level await before execution.
#   2. WebLoop.run_until_complete is wrapped so calls the rewrite can't reach
#      (e.g. inside a sync helper function) fail with an actionable message
#      instead of a cryptic JSPI error.
import ast as _ast


def _wingman_rewrite_async(code):
    """Rewrite blocking asyncio entrypoints into top-level await.

    Handles `asyncio.run(x)`, `<anything>.run_until_complete(x)` and
    `run_sync(x)` outside function/class bodies (where `await` is valid via
    top-level await). Returns the source unchanged when nothing matches or it
    doesn't parse — execution will surface the real error.
    """
    try:
        tree = _ast.parse(code)
    except SyntaxError:
        return code

    class _Rewriter(_ast.NodeTransformer):
        changed = False

        # `await` is only valid at module level here — leave function, class
        # and lambda bodies untouched.
        def _skip(self, node):
            return node

        visit_FunctionDef = _skip
        visit_AsyncFunctionDef = _skip
        visit_Lambda = _skip
        visit_ClassDef = _skip

        def visit_Call(self, node):
            self.generic_visit(node)
            func = node.func
            is_asyncio_run = (
                isinstance(func, _ast.Attribute)
                and func.attr == "run"
                and isinstance(func.value, _ast.Name)
                and func.value.id == "asyncio"
            )
            is_run_until_complete = isinstance(func, _ast.Attribute) and func.attr == "run_until_complete"
            is_run_sync = (isinstance(func, _ast.Name) and func.id == "run_sync") or (
                isinstance(func, _ast.Attribute) and func.attr == "run_sync"
            )
            if (is_asyncio_run or is_run_until_complete or is_run_sync) and len(node.args) == 1:
                self.changed = True
                return _ast.Await(value=node.args[0])
            return node

    rewriter = _Rewriter()
    tree = rewriter.visit(tree)
    if not rewriter.changed:
        return code
    return _ast.unparse(_ast.fix_missing_locations(tree))


def _wingman_patch_webloop():
    from pyodide.webloop import WebLoop

    original = WebLoop.run_until_complete

    def run_until_complete(self, future):
        try:
            return original(self, future)
        except RuntimeError as error:
            if "stack switching" not in str(error):
                raise
            raise RuntimeError(
                "asyncio.run() / loop.run_until_complete() cannot block in this browser sandbox. "
                "Use top-level await instead: replace `asyncio.run(main())` with `await main()`."
            ) from None

    WebLoop.run_until_complete = run_until_complete


_wingman_patch_webloop()
