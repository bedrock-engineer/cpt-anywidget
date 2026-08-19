import math
import pathlib

import anywidget
import traitlets

from cpt_anywidget.intake import _normalize_traits, split, tidy

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


class ProfileViewer(anywidget.AnyWidget):
    """d3-based length profile: multiple CPTs side by side as strips on
    one shared, zoomable vertical (NAP) axis, anchored by their chainage
    along the profile line. A toolbar toggle switches between true-scale
    and equal spacing; the ``selected`` trait syncs the clicked strip's
    name back to Python — observe it to open the full :class:`CPTViewer`
    beside the profile.
    """

    _esm = _HERE / "static" / "profile-viewer.js"

    # the strips: [{"name", "distance", "data": {...}, "layers"?}, ...]
    # — distance is the chainage along the profile line in m; data
    # follows the cptData contract (equal-length lists, None for missing
    # samples, sorted so the first sample is the topmost); layers
    # ([{"top", "bottom", "color"?, "label"?}, ...], boundaries in the
    # vertical coordinate) render as a semi-transparent full-width
    # backdrop behind the strip's curves
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

    # the channels every strip plots, stacked axis slots in list order:
    # column keys or {"key", "label"?, "unit"?, "color"?} dicts merged
    # over the front end's display defaults; [] = coneResistance only
    channels = traitlets.List().tag(sync=True)

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
        channels=None,
        layers=None,
        limits=None,
        **kwargs,
    ):
        """Pythonic facade over the JSON-flat traits.

        ``data`` — tidy long-format columns: a polars or pandas DataFrame
        or dict of equal-length lists holding every CPT's samples, with a
        name column telling them apart. Rows are grouped per CPT via
        :func:`~cpt_anywidget.intake.split`, then each group goes through
        :func:`~cpt_anywidget.intake.tidy` exactly like
        :class:`CPTViewer` data.
        ``positions`` — {name: chainage in m} along the profile line (see
        :func:`chainage` to compute it from map coordinates); every name
        in ``data`` must be present. Omitted = input order, one unit
        apart (only sensible with equal spacing).
        ``name`` — the column holding the CPT names.
        ``vertical`` — the vertical-coordinate column (→ ``verticalKey``):
        a column-name string, :class:`~cpt_anywidget.vertical.Vertical`
        binding, or raw spec dict.
        ``channels`` — the plotted channels, mixing column-name strings,
        :class:`Channel` bindings, and raw dicts (→ ``channels``);
        omitted = cone resistance only.
        ``layers`` — {name: [{"top", "bottom", "color"?, "label"?},
        ...]} interpreted layers per CPT, boundaries in the vertical
        coordinate, drawn as a semi-transparent backdrop filling the
        strip behind its curves. Names absent from ``data`` raise;
        ``data`` names without layers just plot curves.
        ``limits`` — {column: (min, max)} axis overrides
        (→ ``axisLimits``); the vertical pair is oriented to the render
        direction, so callers can pass it either way round.

        Trait names still pass through ``**kwargs`` unchanged; a raw
        ``verticalKey=`` kwarg still counts as the vertical here (it
        orients ``limits`` and sorts ``data``), and data passed raw via
        ``cpts=`` skips all of the above.
        """
        vert, traits = _normalize_traits(
            vertical=vertical,
            channels=channels,
            limits=limits,
            default=kwargs.get(
                "verticalKey", type(self).verticalKey.default_value
            ),
        )
        if data is not None:
            groups = split(data, name)
            if positions is None:
                positions = {n: float(i) for i, n in enumerate(groups)}
            missing = sorted(set(groups) - set(positions))
            if missing:
                raise ValueError(f"positions missing for {missing}")
            if layers:
                unknown = sorted(set(layers) - set(groups))
                if unknown:
                    raise ValueError(f"layers for unknown CPTs {unknown}")
            kwargs["cpts"] = sorted(
                (
                    {
                        "name": n,
                        "distance": float(positions[n]),
                        "data": tidy(cols, vert),
                        **(
                            {"layers": list(layers[n])}
                            if layers and n in layers
                            else {}
                        ),
                    }
                    for n, cols in groups.items()
                ),
                key=lambda c: c["distance"],
            )
        kwargs.update(traits)
        super().__init__(**kwargs)
