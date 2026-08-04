import math
import pathlib

import anywidget
import traitlets

from cpt_anywidget.cpt_viewer import Channel, _columns, _sorted_columns
from cpt_anywidget.vertical import Vertical, resolve_vertical

_HERE = pathlib.Path(__file__).parent


def chainage(coords):
    """Cumulative along-profile distance per CPT, from map coordinates.

    ``coords`` — {name: (x, y)} in a projected CRS (e.g. RD New), in
    profile order: each CPT's chainage is the summed straight-line
    distance over its predecessors, first entry at 0. Feed the result
    to :class:`ProfileViewer` as ``positions``.
    """
    out = {}
    total = 0.0
    prev = None
    for name, (x, y) in coords.items():
        x, y = float(x), float(y)
        if prev is not None:
            total += math.hypot(x - prev[0], y - prev[1])
        out[name] = total
        prev = (x, y)
    return out


def _split_cpts(data, name_key):
    """Tidy long columns → {name: columns}: rows grouped by the name
    column (kept in first-appearance order), the remaining columns
    scrubbed JSON-safe per group. Same input contract as ``_columns``
    plus the name column.
    """
    if not hasattr(data, "items"):  # polars DataFrame
        data = data.to_dict(as_series=False)
    data = {str(k): list(v) for k, v in data.items()}
    if name_key not in data:
        raise ValueError(
            f"name column {name_key!r} not in data (columns: {sorted(data)})"
        )
    names = [str(n) for n in data.pop(name_key)]
    columns = _columns(data)
    if columns and len(names) != len(next(iter(columns.values()))):
        raise ValueError("name column length differs from the data columns")
    rows = {}
    for i, n in enumerate(names):
        rows.setdefault(n, []).append(i)
    return {
        n: {k: [v[i] for i in idx] for k, v in columns.items()}
        for n, idx in rows.items()
    }


class ProfileViewer(anywidget.AnyWidget):
    """d3-based length profile: multiple CPTs side by side as strips on
    one shared, zoomable vertical (NAP) axis, anchored by their chainage
    along the profile line. A toolbar toggle switches between true-scale
    and equal spacing; the ``selected`` trait syncs the clicked strip's
    name back to Python — observe it to open the full :class:`CPTViewer`
    beside the profile.
    """

    _esm = _HERE / "static" / "profile-viewer.js"

    # the strips: [{"name", "distance", "data": {...}}, ...] — distance
    # is the chainage along the profile line in m; data follows the
    # cptData contract (equal-length lists, None for missing samples,
    # sorted so the first sample is the topmost)
    cpts = traitlets.List().tag(sync=True)

    # which data column is the vertical coordinate — a key string or a
    # {"key", "label"?, "up"?, "format"?} dict (see vertical.Vertical);
    # a length profile compares elevations across CPTs, so "nap" is the
    # default here
    verticalKey = traitlets.Union(
        [traitlets.Unicode(), traitlets.Dict()], default_value="nap"
    ).tag(sync=True)

    # [min, max] overrides: the plotted channel's key sets the one scale
    # shared by all strips, the vertical override is keyed by verticalKey
    axisLimits = traitlets.Dict().tag(sync=True)

    # the channel every strip plots: a column key or {"key", "label"?,
    # "unit"?, "color"?} merged over the front end's display defaults;
    # "" = coneResistance
    channel = traitlets.Union(
        [traitlets.Unicode(), traitlets.Dict()], default_value=""
    ).tag(sync=True)

    # profile-space lines over the strips: [{"points" | "levels", "label"?,
    # "color"?, "dash"?, "width"?}, ...]. "points": [[distance, v], ...] is
    # a polyline — distance in m chainage, v in the vertical coordinate;
    # under equal spacing the x positions interpolate between the strip
    # anchors. "levels": {name: v} draws v flat across that strip's width
    # (e.g. each CPT's surface level), consecutive strips joined by a
    # sloping connector; an absent name bridges to the next strip with a
    # value, an explicit None breaks the line
    overlays = traitlets.List().tag(sync=True)

    # horizontal reference lines spanning the whole profile, same shape
    # as CPTViewer's annotations
    annotations = traitlets.List().tag(sync=True)

    # strip spacing: False anchors strips at true chainage, True spaces
    # them evenly; the widget's toolbar toggle writes this back
    equalSpacing = traitlets.Bool(False).tag(sync=True)

    # the clicked strip's name, "" when nothing is selected —
    # bidirectional: clicking the selected strip again deselects
    selected = traitlets.Unicode("").tag(sync=True)

    # px per strip; 0 (the default) falls back to the front end's 90
    stripWidth = traitlets.Int().tag(sync=True)

    # plot size in px; 0 falls back to the front end's 700x500. Width is
    # a minimum: the svg grows past it (and the widget scrolls sideways)
    # whenever true-scale chainage or the strip count needs the room
    width = traitlets.Int().tag(sync=True)

    height = traitlets.Int().tag(sync=True)

    def __init__(
        self,
        data=None,
        *,
        positions=None,
        name="name",
        vertical=None,
        channel=None,
        limits=None,
        **kwargs,
    ):
        """Pythonic facade over the JSON-flat traits.

        ``data`` — tidy long-format columns: a polars or pandas DataFrame
        or dict of equal-length lists holding every CPT's samples, with a
        name column telling them apart. Rows are grouped per CPT, then
        sanitized and sorted exactly like :class:`CPTViewer` data.
        ``positions`` — {name: chainage in m} along the profile line (see
        :func:`chainage` to compute it from map coordinates); every name
        in ``data`` must be present. Omitted = input order, one unit
        apart (only sensible with equal spacing).
        ``name`` — the column holding the CPT names.
        ``vertical`` — the vertical-coordinate column (→ ``verticalKey``):
        a column-name string, :class:`~cpt_anywidget.vertical.Vertical`
        binding, or raw spec dict.
        ``channel`` — the plotted channel: a column-name string,
        :class:`Channel` binding, or raw dict (→ ``channel``).
        ``limits`` — {column: (min, max)} axis overrides
        (→ ``axisLimits``); the vertical pair is oriented to the render
        direction, so callers can pass it either way round.

        Trait names still pass through ``**kwargs`` unchanged; data
        passed raw via ``cpts=`` skips all of the above.
        """
        vert = resolve_vertical(
            vertical
            if vertical is not None
            else type(self).verticalKey.default_value
        )
        descending = vert.up  # elevation: highest sample on top
        if data is not None:
            groups = _split_cpts(data, name)
            if positions is None:
                positions = {n: float(i) for i, n in enumerate(groups)}
            missing = sorted(set(groups) - set(positions))
            if missing:
                raise ValueError(f"positions missing for {missing}")
            kwargs["cpts"] = sorted(
                (
                    {
                        "name": n,
                        "distance": float(positions[n]),
                        "data": _sorted_columns(cols, vert.key, descending),
                    }
                    for n, cols in groups.items()
                ),
                key=lambda c: c["distance"],
            )
        if vertical is not None:
            kwargs["verticalKey"] = (
                vertical.spec() if isinstance(vertical, Vertical) else vertical
            )
        if channel is not None:
            kwargs["channel"] = (
                channel.spec() if isinstance(channel, Channel) else channel
            )
        if limits is not None:
            kwargs["axisLimits"] = {
                k: sorted(v, reverse=descending) if k == vert.key else list(v)
                for k, v in limits.items()
            }
        super().__init__(**kwargs)
