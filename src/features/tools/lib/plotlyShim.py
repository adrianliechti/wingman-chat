import json as _json
import os as _os

_PLOTLY_RENDER_QUEUE_DIR = "/tmp/__plotly_render_queue__"
_plotly_render_counter = 0

_os.makedirs(_PLOTLY_RENDER_QUEUE_DIR, exist_ok=True)


def _plotly_shim_write_image(fig, file, format=None, width=None, height=None, scale=None, validate=True, engine=None, **kwargs):
    global _plotly_render_counter

    if not isinstance(file, str):
        raise RuntimeError(
            "plotly write_image() to file-like objects is not supported in this environment. "
            "Use a file path string instead."
        )

    # Infer format from extension if not specified
    if format is None:
        _, ext = _os.path.splitext(file)
        format = ext.lstrip(".").lower() if ext else "png"
    format = format.lower()
    if format == "jpg":
        format = "jpeg"

    if format in ("pdf", "eps"):
        raise RuntimeError(
            f"'{format}' format is not supported in the browser environment. "
            "Use 'png', 'svg', 'jpeg', or 'webp' instead."
        )

    fig_dict = fig.to_plotly_json()

    manifest = {
        "fig": fig_dict,
        "file": file,
        "format": format,
        "width": width,
        "height": height,
        "scale": scale,
    }

    manifest_path = _os.path.join(
        _PLOTLY_RENDER_QUEUE_DIR, f"request_{_plotly_render_counter:04d}.json"
    )
    _plotly_render_counter += 1

    with open(manifest_path, "w") as f:
        _json.dump(manifest, f)


def _plotly_shim_to_image(fig, format=None, width=None, height=None, scale=None, validate=True, engine=None, **kwargs):
    raise RuntimeError(
        "plotly to_image() is not supported in this environment. "
        "Use fig.write_image('/home/pyodide/chart.png') to save an image file instead."
    )


# Patch plotly.io — write directly to __dict__ to avoid triggering __getattr__
# lazy imports (which would try to import kaleido).
import plotly.io as _pio

_pio.__dict__["write_image"] = _plotly_shim_write_image
_pio.__dict__["to_image"] = _plotly_shim_to_image

# Patch Figure instance methods
import plotly.graph_objects as _go

_go.Figure.write_image = _plotly_shim_write_image
_go.Figure.to_image = _plotly_shim_to_image
if hasattr(_go, "FigureWidget"):
    _go.FigureWidget.write_image = _plotly_shim_write_image
    _go.FigureWidget.to_image = _plotly_shim_to_image
