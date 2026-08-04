import pathlib

import anywidget
import traitlets

from cpt_anywidget.vertical import to_vertical

_HERE = pathlib.Path(__file__).parent

# fill for soil names missing from the BRO lithology table
_FALLBACK_COLOR = "#b0b0b0"


def _hex(color):
    r, g, b = (round(c * 255) for c in color)
    return f"#{r:02x}{g:02x}{b:02x}"


def layers_from_bhrgt(bhrgt, vertical_key="depth"):
    """Convert a ``brodata.bhr.GeotechnicalBoreholeResearch`` into the
    ``layers`` trait of :class:`BHRGTViewer`.

    Each descriptive-log layer becomes ``{"top", "bottom", "label",
    "bands"}`` with top/bottom in the requested vertical coordinate
    (``"depth"`` below surface, or a positive-up one like ``"nap"``
    via the borehole's offset).
    Bands are the proportional soil-composition sub-bands from brodata's
    BRO lithology table: ``{"x1", "x2", "color", "hatch"?}`` with x in
    [0, 1] and hatch a matplotlib-style pattern char ("-", "/", "\\\\",
    ".", "o", "|") the front end maps to an SVG pattern.
    """
    from brodata.plot import get_bro_lithology_properties

    table = get_bro_lithology_properties()
    # BRO XML does not guarantee layer order; the front end expects the
    # shallowest layer first
    df = bhrgt.descriptiveBoreholeLog[0]["layer"].sort_values("upperBoundary")

    layers = []
    for row in df.itertuples():
        spec = table.get(row.geotechnicalSoilName)
        if spec is None:
            bands = [{"x1": 0, "x2": 1, "color": _FALLBACK_COLOR}]
        else:
            # base lithologies are a single dict, composites a list of
            # {"width", "color", "hatch"?} sub-bands stacking to <= 1
            if isinstance(spec, dict):
                spec = [{"width": 1, **spec}]
            bands = []
            x = 0.0
            for sub in spec:
                band = {"x1": x, "x2": x + sub["width"], "color": _hex(sub["color"])}
                if "hatch" in sub:
                    band["hatch"] = sub["hatch"]
                x = band["x2"]
                bands.append(band)
        layers.append(
            {
                "top": to_vertical(row.upperBoundary, bhrgt.offset, vertical_key),
                "bottom": to_vertical(row.lowerBoundary, bhrgt.offset, vertical_key),
                "label": row.geotechnicalSoilName,
                "bands": bands,
            }
        )
    return layers


class BHRGTViewer(anywidget.AnyWidget):
    """d3-based geotechnical borehole (BHR-GT) chart: soil-composition
    bands per layer on a shared, zoomable vertical axis, with hover
    readouts and reference-line annotations. Zoom/brush interactions
    match CPTViewer so the two can sit side by side on the same axis.
    """

    _esm = _HERE / "static" / "bhrgt-viewer.js"

    # [{"top", "bottom", "label", "bands": [{"x1", "x2", "color",
    # "hatch"?}, ...]}, ...] — top/bottom in the current vertical
    # coordinate, bands proportional in x [0, 1]; see layers_from_bhrgt
    layers = traitlets.List().tag(sync=True)

    # vertical coordinate the layers are expressed in — a key string
    # ("depth"/"nap" carry display defaults) or a {"key", "label"?,
    # "up"?, "format"?} dict (see vertical.Vertical); only used for the
    # axis label/format — the front end follows layer order
    verticalKey = traitlets.Union(
        [traitlets.Unicode(), traitlets.Dict()], default_value="depth"
    ).tag(sync=True)

    # {verticalKey: [min, max]} override for the vertical axis; the
    # data-driven fallback spans first layer top to last layer bottom
    axisLimits = traitlets.Dict().tag(sync=True)

    # horizontal reference lines (e.g. groundwater): same contract as
    # CPTViewer — {"at", "label", "color"?, "dash"?, "position"?,
    # "offset"?}, "at" in the current vertical coordinate
    annotations = traitlets.List().tag(sync=True)

    # plot size in px; 0 (the default) falls back to the front end's 220x800
    height = traitlets.Int().tag(sync=True)

    width = traitlets.Int().tag(sync=True)
