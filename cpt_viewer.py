import dataclasses
import math
import pathlib

import anywidget
import traitlets

_HERE = pathlib.Path(__file__).parent


@dataclasses.dataclass
class Channel:
    """Binding of a data column to a plotted channel, Observable Plot
    style: the data keeps its own column names and the binding adapts
    the chart — never the reverse. Only ``key`` is required; omitted
    fields fall back to the front end's display defaults (label = the
    key, palette color, bottom side).
    """

    key: str
    label: str | None = None
    unit: str | None = None
    color: str | None = None
    side: str | None = None  # "bottom" | "top"

    def spec(self):
        """The channels-trait dict, omitted fields dropped so the front
        end's per-key defaults still apply."""
        return {
            k: v for k, v in dataclasses.asdict(self).items() if v is not None
        }


def _scrub(value):
    """One JSON-safe sample: numpy scalars unwrapped, NaN → None."""
    if hasattr(value, "item"):  # numpy scalar
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def _columns(data):
    """A DataFrame or dict of columns → the cptData dict: plain lists,
    JSON-safe samples. Both inputs expose ``.items()`` yielding
    (name, iterable of samples), so no pandas import is needed here.
    """
    return {
        str(key): [_scrub(v) for v in values] for key, values in data.items()
    }


class CPTViewer(anywidget.AnyWidget):
    """d3-based CPT chart: measurement channels plotted against a shared,
    zoomable depth axis, with hover readouts, reference-line annotations,
    and read-only soil-interpretation columns.

    The ``editedLayers`` trait is the manually editable layer column —
    bidirectional, so read it back for the user's picks. Front-end edits:
    drag a boundary to move it, double-click a layer to split it there,
    option-click a boundary to merge (the upper layer wins), click a
    layer to pick its class from the ``soil_classes`` pie menu.
    Layer color and label derive from the palette via each layer's
    ``class`` key.
    """

    _esm = _HERE / "index.js"
    _css = _HERE / "index.css"

    # {"depth": [...], "nap": [...], "coneResistance": [...], ...} —
    # equal-length lists, None for missing samples (NaN is not valid JSON)
    cptData = traitlets.Dict().tag(sync=True)

    # which cptData column is the vertical coordinate: "depth" (below
    # surface, positive down) or "nap" (elevation, positive up); the front
    # end follows the data order, first sample at the top
    verticalKey = traitlets.Unicode("depth").tag(sync=True)

    # per-channel [min, max] axis overrides, e.g. {"coneResistance": [0, 30],
    # "depth": [0, 25]}; the vertical override is keyed by verticalKey;
    # omitted channels fall back to the data-driven min/max
    axisLimits = traitlets.Dict().tag(sync=True)

    # horizontal reference lines: {"at", "label", "color"?, "dash"?,
    # "position"?: "left"|"center"|"right", "offset"?: [dx, dy]} — "at" is a
    # value in the current vertical coordinate
    annotations = traitlets.List().tag(sync=True)

    # read-only interpretation columns stacked right of the plot (no x axis):
    # [{"label": "Robertson", "layers": [{"top", "bottom", "label"?,
    # "color"?}, ...]}, ...] — "top"/"bottom" are values in the current
    # vertical coordinate
    interpretations = traitlets.List().tag(sync=True)

    # nearby geotechnical borehole, rendered left of the plot on the shared
    # axis: {"label", "layers": [{"top", "bottom", "label"?, "bands":
    # [{"x1", "x2", "color", "hatch"?}, ...]}, ...]} — "top"/"bottom" in the
    # current vertical coordinate (the borehole and CPT surfaces sit at
    # different elevations, so convert through NAP notebook-side; see
    # bhrgt_viewer.layers_from_bhrgt for the band shape); {} hides the column
    borehole = traitlets.Dict().tag(sync=True)

    # manually editable layer column, stacked after the interpretation
    # columns: [{"top", "bottom", "class"?, "label"?, "color"?}, ...] — one
    # flat layer list, same vertical-coordinate convention as an
    # interpretation column's "layers"; the front end writes edits back.
    # "class" references a soil_classes entry by name and drives the fill;
    # explicit "color" is only a fallback for classless layers
    editedLayers = traitlets.List().tag(sync=True)

    # soil-class palette, the single source of truth for layer colors:
    # [{"name", "color", "label"?}, ...] — layers reference entries by
    # "name"; override to change classes or colors project-wide
    soil_classes = traitlets.List(
        [
            {"name": "gravel", "color": "#d88c3c"},
            {"name": "sand", "color": "#f4e04d"},
            {"name": "silt", "color": "#b5a642"},
            {"name": "clay", "color": "#78a86c"},
            {"name": "peat", "color": "#8a6642"},
        ]
    ).tag(sync=True)

    # which cptData channels to plot, in axis stacking order: entries are a
    # channel key or {"key", "label"?, "unit"?, "color"?, "side"?:
    # "bottom"|"top"} — overrides are merged over the front end's display
    # defaults, and unknown keys add new plottable channels; empty list =
    # all default channels
    channels = traitlets.List().tag(sync=True)

    # plot size in px; 0 (the default) falls back to the front end's 400x800
    height = traitlets.Int().tag(sync=True)

    width = traitlets.Int().tag(sync=True)

    def __init__(
        self, data=None, *, vertical=None, channels=None, limits=None, **kwargs
    ):
        """Pythonic facade over the JSON-flat traits.

        ``data`` — tidy columns: a pandas DataFrame or dict of
        equal-length lists (one row per depth sample, one column per
        measurement). NaN and numpy scalars are sanitized here, so
        callers never hand-build the JSON-safe dict.
        ``vertical`` — which column is the vertical coordinate
        (→ ``verticalKey``).
        ``channels`` — mix of column-name strings, :class:`Channel`
        bindings, and raw dicts, in axis stacking order.
        ``limits`` — {column: (min, max)} axis overrides
        (→ ``axisLimits``).

        Trait names (``cptData=``, ``annotations=``, …) still pass
        through ``**kwargs`` unchanged — the wire format is the traits;
        this constructor only normalizes into them.
        """
        if data is not None:
            kwargs["cptData"] = _columns(data)
        if vertical is not None:
            kwargs["verticalKey"] = vertical
        if channels is not None:
            kwargs["channels"] = [
                c.spec() if isinstance(c, Channel) else c for c in channels
            ]
        if limits is not None:
            kwargs["axisLimits"] = {k: list(v) for k, v in limits.items()}
        super().__init__(**kwargs)
