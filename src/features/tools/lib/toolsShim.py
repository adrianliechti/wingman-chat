import json as _json
from pyodide.ffi import JsException as _JsException


class _WingmanTools:
    @staticmethod
    async def list():
        """List this run's callable tools and their JSON schemas."""
        return _json.loads(await _wingman_list_tools())

    @staticmethod
    async def call(name, args=None):
        """Call a listed tool with a dict and return its structured result or text."""
        try:
            result = await _wingman_call_tool(name, _json.dumps({} if args is None else args))
        except _JsException as error:
            raise RuntimeError(str(error.message)) from None
        return _json.loads(result)


tools = _WingmanTools()
