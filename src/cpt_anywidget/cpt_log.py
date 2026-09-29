import pathlib

import anywidget
import traitlets

from cpt_anywidget.intake import _normalize_traits, tidy

_HERE = pathlib.Path(__file__).parent


class CPTLog(anywidget.AnyWidget):
    """d3-based CPT log: measurement channels plotted against a shared,
    zoomable vertical axis, with hover readouts, reference-line
    annotations, and channel-space overlays.

    The standalone measurement view: the same chart the
    :class:`~cpt_anywidget.cpt_viewer.CPTViewer` draws, without its
    interpretation, borehole, and editable-layer columns. Use it to show
    a sounding on its own; reach for ``CPTViewer`` when you also want to
    read or edit soil layering against the curves.
    """

    _esm = _HERE / "static" / "cpt-log.js"
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
        measurement), from whatever reader parsed the format. Goes
        through :func:`~cpt_anywidget.intake.tidy`: JSON-safe samples
        (NaN/inf → None, numpy scalars unwrapped — non-numeric samples
        raise), rows sorted so the first sample is the topmost —
        ascending for ``"depth"``, descending for ``"nap"`` — which is
        the order the front end renders in.
        ``vertical`` — which column is the vertical coordinate
        (→ ``verticalKey``); must be present in ``data``. A column-name
        string, :class:`~cpt_anywidget.vertical.Vertical` binding, or
        raw spec dict — "depth" sorts ascending, "nap" descending, any
        other datum says which way is up via the binding.
        ``channels`` — mix of column-name strings,
        :class:`~cpt_anywidget.cpt_viewer.Channel` bindings, and raw
        dicts, in axis stacking order.
        ``limits`` — {column: (min, max)} axis overrides
        (→ ``axisLimits``); the vertical column's pair is oriented to the
        render direction, so callers can pass it either way round.

        Trait names (``cptData=``, ``annotations=``, …) still pass
        through ``**kwargs`` unchanged — the wire format is the traits;
        this constructor only normalizes into them. A raw
        ``verticalKey=`` kwarg still counts as the vertical here: it
        orients ``limits`` and sorts ``data``. Data passed raw via
        ``cptData=`` skips all of the above.
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
            kwargs["cptData"] = tidy(data, vert)
        kwargs.update(traits)
        super().__init__(**kwargs)
