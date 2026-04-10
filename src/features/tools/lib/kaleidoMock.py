import micropip
import types
import sys

micropip.add_mock_package("kaleido", "1.0.0")

_m = types.ModuleType("kaleido")
_m.__version__ = "1.0.0"
sys.modules["kaleido"] = _m

_s = types.ModuleType("kaleido.scopes")
sys.modules["kaleido.scopes"] = _s
_m.scopes = _s

del _m, _s
