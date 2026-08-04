import dataclasses
import math
import pathlib

import anywidget
import traitlets

from cpt_anywidget.vertical import Vertical, resolve_vertical

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
    """One JSON-safe sample: numpy scalars unwrapped, numeric strings
    coerced (BRO XML sometimes delivers them), NaN/±inf → None."""
    if hasattr(value, "item"):  # numpy scalar
        value = value.item()
    if isinstance(value, str):
        value = float(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _columns(data):
    """Tidy columns → the cptData dict: plain lists, JSON-safe samples.

    Accepts a dict of equal-length iterables, a pandas DataFrame (both
    expose ``.items()``), or a polars DataFrame (via
    ``to_dict(as_series=False)``) — the notebooks this serves are
    polars-first, so no dataframe import happens here either way.
    Ragged columns error immediately: the front end indexes all columns
    by the vertical sample position, so a length mismatch would silently
    misalign every channel.
    """
    if not hasattr(data, "items"):  # polars DataFrame
        data = data.to_dict(as_series=False)
    columns = {}
    for key, values in data.items():
        try:
            columns[str(key)] = [_scrub(v) for v in values]
        except (TypeError, ValueError) as e:
            raise ValueError(
                f"column {key!r} holds a non-numeric sample: {e}"
            ) from None
    lengths = {k: len(v) for k, v in columns.items()}
    if len(set(lengths.values())) > 1:
        raise ValueError(f"columns differ in length: {lengths}")
    return columns


def _sorted_columns(columns, key, descending):
    """Row-sort the columns by the vertical column so the first sample
    is the topmost — the render-order contract the front end relies on.
    Samples with a missing vertical value are dropped: they cannot be
    placed on the axis, and the front end reads the axis domain off the
    first and last samples.
    """
    if key not in columns:
        raise ValueError(
            f"vertical column {key!r} not in data "
            f"(columns: {sorted(columns)})"
        )
    vertical = columns[key]
    order = [i for i, v in enumerate(vertical) if v is not None]
    order.sort(key=vertical.__getitem__, reverse=descending)
    return {name: [vals[i] for i in order] for name, vals in columns.items()}


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

    _esm = _HERE / "static" / "cpt-viewer.js"
    _css = _HERE / "index.css"

    # {"depth": [...], "nap": [...], "coneResistance": [...], ...} —
    # equal-length lists, None for missing samples (NaN is not valid JSON)
    cptData = traitlets.Dict().tag(sync=True)

    # which cptData column is the vertical coordinate: "depth" (below
    # surface, positive down) and "nap" (elevation, positive up) carry
    # built-in display defaults; a {"key", "label"?, "up"?, "format"?}
    # dict (see vertical.Vertical) binds any other column. The front
    # end follows the data order, first sample at the top
    verticalKey = traitlets.Union(
        [traitlets.Unicode(), traitlets.Dict()], default_value="depth"
    ).tag(sync=True)

    # per-channel [min, max] axis overrides, e.g. {"coneResistance": [0, 30],
    # "depth": [0, 25]}; the vertical override is keyed by verticalKey;
    # omitted channels fall back to the data-driven min/max
    axisLimits = traitlets.Dict().tag(sync=True)

    # horizontal reference lines: {"at", "label", "color"?, "dash"?,
    # "position"?: "left"|"center"|"right", "offset"?: [dx, dy]} — "at" is a
    # value in the current vertical coordinate
    annotations = traitlets.List().tag(sync=True)

    # polylines drawn in a channel's x coordinate against the shared
    # vertical axis, e.g. a fitted hydrostatic pore-pressure line:
    # [{"channel": cptData key, "points": [[x, v], ...], "color"?, "dash"?,
    # "width"?}, ...] — x in the channel's unit, v in the current vertical
    # coordinate; an overlay whose channel is not plotted is skipped
    overlays = traitlets.List().tag(sync=True)

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

        ``data`` — tidy columns: a polars or pandas DataFrame, or dict of
        equal-length lists (one row per depth sample, one column per
        measurement). Samples are sanitized here (NaN/inf → None, numpy
        scalars and numeric strings → float) and rows are sorted so the
        first sample is the topmost — ascending for ``"depth"``,
        descending for ``"nap"`` — which is the order the front end
        renders in. Callers never hand-build the JSON-safe dict.
        ``vertical`` — which column is the vertical coordinate
        (→ ``verticalKey``); must be present in ``data``. A column-name
        string, :class:`~cpt_anywidget.vertical.Vertical` binding, or
        raw spec dict — "depth" sorts ascending, "nap" descending, any
        other datum says which way is up via the binding.
        ``channels`` — mix of column-name strings, :class:`Channel`
        bindings, and raw dicts, in axis stacking order.
        ``limits`` — {column: (min, max)} axis overrides
        (→ ``axisLimits``); the vertical column's pair is oriented to the
        render direction, so callers can pass it either way round.

        Trait names (``cptData=``, ``annotations=``, …) still pass
        through ``**kwargs`` unchanged — the wire format is the traits;
        this constructor only normalizes into them. Data passed raw via
        ``cptData=`` skips all of the above.
        """
        vert = resolve_vertical(
            vertical
            if vertical is not None
            else type(self).verticalKey.default_value
        )
        descending = vert.up  # elevation: highest sample on top
        if data is not None:
            kwargs["cptData"] = _sorted_columns(
                _columns(data), vert.key, descending
            )
        if vertical is not None:
            kwargs["verticalKey"] = (
                vertical.spec() if isinstance(vertical, Vertical) else vertical
            )
        if channels is not None:
            kwargs["channels"] = [
                c.spec() if isinstance(c, Channel) else c for c in channels
            ]
        if limits is not None:
            kwargs["axisLimits"] = {
                k: sorted(v, reverse=descending) if k == vert.key else list(v)
                for k, v in limits.items()
            }
        super().__init__(**kwargs)
