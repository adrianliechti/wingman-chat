"""Script entry points and static local imports for the reused Pyodide runtime."""
import ast as _script_ast
import importlib as _script_importlib
import json as _script_json
import linecache as _script_linecache
import sys as _script_sys
import types as _script_types
from pathlib import Path as _ScriptPath
from pyodide.code import eval_code_async as _script_eval


def _wingman_script_sources(code, filename):
    """Inspect reachable workspace modules without importing or executing them."""
    home = _ScriptPath("/home/user")
    entry = _ScriptPath(filename) if filename else home / "<exec>"
    roots = list(dict.fromkeys([entry.parent, home]))
    sources = []
    visited = {entry}

    def visit_file(path):
        if path in visited or not path.is_file() or not path.resolve().is_relative_to(home):
            return
        visited.add(path)
        visit_source(path.read_text(encoding="utf-8-sig"), path)

    def visit_module(parts, search_roots):
        for part in parts:
            next_roots = []
            for root in search_roots:
                candidate = root / part
                # Match Python: regular packages precede same-named modules;
                # namespace directories yield to regular packages/modules.
                initializer = candidate / "__init__.py"
                if initializer.is_file():
                    visit_file(initializer)
                    next_roots = [candidate]
                    break
                module = candidate.with_suffix(".py")
                if module.is_file():
                    visit_file(module)
                    return
                if candidate.is_dir():
                    next_roots.append(candidate)
            search_roots = next_roots
            if not search_roots:
                return

    def visit_source(source, path):
        sources.append(source)
        try:
            tree = _script_ast.parse(source)
        except SyntaxError:
            # The actual execution reports syntax errors with the script filename.
            return
        for node in _script_ast.walk(tree):
            if isinstance(node, _script_ast.Import):
                for alias in node.names:
                    visit_module(alias.name.split("."), roots)
            elif isinstance(node, _script_ast.ImportFrom):
                search_roots = roots
                if node.level:
                    root = path.parent
                    for _ in range(node.level - 1):
                        root = root.parent
                    search_roots = [root]
                parts = node.module.split(".") if node.module else []
                visit_module(parts, search_roots)
                for alias in node.names:
                    if alias.name != "*":
                        visit_module([*parts, alias.name], search_roots)

    visit_source(code, entry)
    return sources


def _wingman_script_scope(filename, args_json):
    """Provide normal script metadata while keeping file I/O rooted in the workspace."""
    home = "/home/user"
    previous_main = _script_sys.modules.get("__main__")
    previous_argv = _script_sys.argv
    previous_path = _script_sys.path
    previous_bytecode = _script_sys.dont_write_bytecode
    main = _script_types.ModuleType("__main__")
    if filename:
        main.__file__ = filename
    _script_sys.modules["__main__"] = main
    _script_sys.argv = [filename or "-c", *_script_json.loads(args_json)]
    script_dir = str(_ScriptPath(filename).parent) if filename else home
    _script_sys.path = list(dict.fromkeys([script_dir, home, *previous_path]))
    _script_sys.dont_write_bytecode = True
    _script_importlib.invalidate_caches()

    def close():
        # Pyodide has formatted any exception before JS calls close(). Keep
        # source lines for that traceback, then discard them between chats.
        _script_linecache.cache.pop("<exec>", None)
        # Local modules must not leak stale code or data into another run/chat.
        # Keep expensive bundled-library imports cached in the reusable runtime.
        local_modules = []
        for name, module in list(_script_sys.modules.items()):
            paths = [getattr(module, "__file__", None), *getattr(module, "__path__", [])]
            if any(isinstance(path, str) and path.startswith(home + "/") for path in paths):
                local_modules.append(name)
        for name in local_modules:
            _script_sys.modules.pop(name, None)
        if previous_main is None:
            _script_sys.modules.pop("__main__", None)
        else:
            _script_sys.modules["__main__"] = previous_main
        _script_sys.argv = previous_argv
        _script_sys.path = previous_path
        _script_sys.dont_write_bytecode = previous_bytecode
        _script_importlib.invalidate_caches()

    return _script_types.SimpleNamespace(namespace=main.__dict__, close=close)


async def _wingman_run_script(code, namespace, filename):
    if not filename:
        # Inline code has no file behind it, so register its source for
        # tracebacks; otherwise frames show a line number without the line.
        filename = "<exec>"
        _script_linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    try:
        return await _script_eval(code, globals=namespace, filename=filename)
    except SystemExit as error:
        if error.code is not None and error.code != 0:
            raise RuntimeError(f"Script exited with status {error.code}") from None
