# End-to-end smoke test for the Pyodide interpreter package loader.
#
# HOW TO RUN: paste this whole file into the chat's code interpreter (or save it
# as an artifact and run it). Every check below triggers the worker's on-demand
# loader, so a green run proves the bundled wheels resolve and import OFFLINE.
#
# Each check is isolated, so one failure never aborts the rest — read the summary
# at the bottom. Heavy packages (opencv, scikit-image, xgboost, lightgbm) pull
# large wheels on first import; comment those out for a quick run.

results = []


def check(name, fn):
    try:
        fn()
        results.append((name, True, ""))
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001 - we want every failure surfaced
        results.append((name, False, repr(e)))
        print(f"FAIL  {name}: {e!r}")


# --- Base-interpreter stdlib (built in since Pyodide 314, no loading) -------

def t_sqlite3():
    import sqlite3  # part of the base interpreter — nothing to load
    con = sqlite3.connect(":memory:")
    con.execute("create table t(x int)")
    con.execute("insert into t values (42)")
    assert con.execute("select x from t").fetchone()[0] == 42


check("stdlib sqlite3", t_sqlite3)


def t_ssl():
    import ssl
    assert ssl.create_default_context() is not None  # import + ctx (no sockets)


check("stdlib ssl (import + context)", t_ssl)


def t_lzma():
    import lzma
    data = b"wingman " * 200
    assert lzma.decompress(lzma.compress(data)) == data


check("stdlib lzma round-trip", t_lzma)


def t_hashlib_base():
    import hashlib  # base stdlib digests (OpenSSL extras dropped in Pyodide 314)
    assert hashlib.sha256(b"abc").hexdigest().startswith("ba7816bf")
    hashlib.pbkdf2_hmac("sha256", b"pw", b"salt", 1000)  # pure-Python fallback


check("stdlib hashlib (base + pbkdf2)", t_hashlib_base)


# --- tzdata / zoneinfo ------------------------------------------------------

def t_zoneinfo():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    dt = datetime(2026, 6, 14, 12, tzinfo=ZoneInfo("Europe/Zurich"))
    assert dt.utcoffset() is not None  # needs IANA db from the tzdata package


check("tzdata / zoneinfo", t_zoneinfo)


def t_pandas_tz():
    import pandas as pd
    ts = pd.Timestamp("2026-06-14 12:00").tz_localize("Europe/Zurich").tz_convert("UTC")
    assert str(ts.tz) == "UTC"


check("pandas tz_localize/tz_convert", t_pandas_tz)


# --- Core data stack (regression check) -------------------------------------

def t_numpy_pandas():
    import numpy as np
    import pandas as pd
    df = pd.DataFrame({"a": np.arange(5)})
    assert int(df["a"].sum()) == 10


check("numpy + pandas", t_numpy_pandas)


def t_matplotlib():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots()
    ax.plot([0, 1, 2], [0, 1, 4])
    fig.savefig("plot.png")
    import os
    assert os.path.getsize("plot.png") > 0


check("matplotlib savefig", t_matplotlib)


def t_pandas_sqlite():
    import sqlite3
    import pandas as pd
    con = sqlite3.connect(":memory:")
    pd.DataFrame({"a": [1, 2, 3]}).to_sql("t", con, index=False)
    out = pd.read_sql("select sum(a) s from t", con)
    assert int(out["s"][0]) == 6


check("pandas <-> sqlite3 round-trip", t_pandas_sqlite)


# --- Spreadsheets -----------------------------------------------------------

def t_excel_openpyxl():
    import pandas as pd
    pd.DataFrame({"a": [1, 2], "b": [3, 4]}).to_excel("test.xlsx", index=False)
    assert pd.read_excel("test.xlsx").shape == (2, 2)  # openpyxl auto-detected


check("excel write/read (openpyxl)", t_excel_openpyxl)


def t_xlrd():
    import xlrd  # legacy .xls reader (openpyxl can't)
    assert hasattr(xlrd, "open_workbook")


check("xlrd import", t_xlrd)


def t_calamine():
    import python_calamine
    assert hasattr(python_calamine, "CalamineWorkbook")


check("python-calamine import", t_calamine)


# --- Validation -------------------------------------------------------------

def t_pydantic():
    from pydantic import BaseModel
    class M(BaseModel):
        x: int
        y: str = "z"
    m = M(x="5")  # type coercion
    assert m.x == 5 and m.y == "z"


check("pydantic v2 model", t_pydantic)


# --- Images (heavy) ---------------------------------------------------------

def t_pillow():
    from PIL import Image
    img = Image.new("RGB", (8, 8), (255, 0, 0))
    img.save("red.png")


check("Pillow", t_pillow)


def t_cv2():
    import cv2
    import numpy as np
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    assert cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).shape == (10, 10)


check("opencv (cv2)", t_cv2)


def t_skimage():
    import numpy as np
    from skimage.filters import gaussian
    assert gaussian(np.zeros((8, 8)), sigma=1).shape == (8, 8)


check("scikit-image", t_skimage)


def t_imageio():
    import imageio.v3 as iio  # PNG plugin uses Pillow, imported above
    import numpy as np
    arr = np.zeros((8, 8, 3), dtype="uint8")
    arr[2:6, 2:6] = 255
    blob = iio.imwrite("<bytes>", arr, extension=".png")
    assert iio.imread(blob).shape[:2] == (8, 8)


check("imageio png encode/decode", t_imageio)


# --- ML (heavy) -------------------------------------------------------------

def t_xgboost():
    import numpy as np
    import xgboost as xgb
    rng = np.random.default_rng(0)
    X = rng.random((40, 3))
    y = (X[:, 0] > 0.5).astype(int)
    d = xgb.DMatrix(X, label=y)
    booster = xgb.train({"objective": "binary:logistic", "max_depth": 2}, d, num_boost_round=3)
    assert booster.predict(d).shape == (40,)


check("xgboost train/predict", t_xgboost)


def t_lightgbm():
    import lightgbm as lgb
    import numpy as np
    rng = np.random.default_rng(0)
    X = rng.random((80, 3))
    y = (X[:, 0] > 0.5).astype(int)
    ds = lgb.Dataset(X, label=y)
    booster = lgb.train({"objective": "binary", "num_leaves": 5, "verbose": -1}, ds, num_boost_round=3)
    assert booster.predict(X).shape == (80,)


check("lightgbm train/predict", t_lightgbm)


# --- Misc helpers -----------------------------------------------------------

def t_regex():
    import regex  # third-party regex with unicode property support
    assert regex.fullmatch(r"\p{Greek}+", "αβγ")


check("regex (unicode properties)", t_regex)


def t_requests_import():
    import requests  # import must succeed; network is sandboxed so we don't call out
    assert hasattr(requests, "get")


check("requests import (no network)", t_requests_import)


# --- Summary ----------------------------------------------------------------

print("\n" + "=" * 48)
passed = sum(1 for _, ok, _ in results if ok)
print(f"{passed}/{len(results)} checks passed")
failures = [(n, e) for n, ok, e in results if not ok]
if failures:
    print("FAILURES:")
    for n, e in failures:
        print(f"  - {n}: {e}")
else:
    print("All interpreter package checks passed ✅")
