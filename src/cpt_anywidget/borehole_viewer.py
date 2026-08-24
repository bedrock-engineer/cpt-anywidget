import pathlib

import anywidget
import traitlets

from cpt_anywidget.intake import _normalize_traits
from cpt_anywidget.lithology import BRO_LITHOLOGY
from cpt_anywidget.vertical import to_vertical

_HERE = pathlib.Path(__file__).parent

# fill for soil names missing from the BRO lithology table
_FALLBACK_COLOR = "#b0b0b0"


def _soil_name_bands(soil_name):
    """Proportional soil-composition bands for a BRO geotechnical soil
    name, looked up in the vendored BRO lithology table; a gray
    full-width band for names the table doesn't know."""
    spec = BRO_LITHOLOGY.get(soil_name)
    if spec is None:
        return [{"x1": 0, "x2": 1, "color": _FALLBACK_COLOR}]
    bands = []
    x = 0.0
    for sub in spec:
        band = {"x1": x, "x2": x + sub["width"], "color": sub["color"]}
        if "hatch" in sub:
            band["hatch"] = sub["hatch"]
        x = band["x2"]
        bands.append(band)
    return bands


def layers_from_bhrgt(bhrgt, vertical_key="depth"):
    """Convert a ``brodata.bhr.GeotechnicalBoreholeResearch`` into the
    ``layers`` trait of :class:`BoreholeViewer`.

    Each descriptive-log layer becomes ``{"top", "bottom", "label",
    "bands"}`` with top/bottom in the requested vertical coordinate
    (``"depth"`` below surface, or a positive-up one like ``"nap"``
    via the borehole's offset).
    Bands are the proportional soil-composition sub-bands from the
    vendored BRO lithology table: ``{"x1", "x2", "color", "hatch"?}``
    with x in [0, 1] and hatch a matplotlib-style pattern char ("-",
    "/", "\\\\", ".", "o", "|") the front end maps to an SVG pattern.
    """
    # BRO XML does not guarantee layer order; the front end expects the
    # shallowest layer first
    df = bhrgt.descriptiveBoreholeLog[0]["layer"].sort_values("upperBoundary")

    layers = []
    for row in df.itertuples():
        layers.append(
            {
                "top": to_vertical(row.upperBoundary, bhrgt.offset, vertical_key),
                "bottom": to_vertical(row.lowerBoundary, bhrgt.offset, vertical_key),
                "label": row.geotechnicalSoilName,
                "bands": _soil_name_bands(row.geotechnicalSoilName),
            }
        )
    return layers


def layers_from_bore(bore, vertical_key="depth"):
    """Convert a ``pygef.bore.BoreData`` (pygef's parse of a GEF or BRO
    XML borehole) into the ``layers`` trait of :class:`BoreholeViewer`.

    pygef normalizes both formats to BRO geotechnical soil names, so the
    layers get the same lithology colors and hatches as
    :func:`layers_from_bhrgt` — same output contract, see there.
    ``"nap"`` (any positive-up vertical) uses the bore's delivered
    vertical position offset.
    """
    offset = bore.delivered_vertical_position_offset

    layers = []
    # pygef sorts the frame by upperBoundary, so shallowest layer first
    for row in bore.data.iter_rows(named=True):
        layer = {
            "top": to_vertical(row["upperBoundary"], offset, vertical_key),
            "bottom": to_vertical(row["lowerBoundary"], offset, vertical_key),
            "label": row["geotechnicalSoilName"],
            "bands": _soil_name_bands(row["geotechnicalSoilName"]),
        }
        # the field description ("remarks" is an optional BoreData
        # column) shows in the hover readout
        remarks = (row.get("remarks") or "").strip()
        if remarks:
            layer["description"] = remarks
        layers.append(layer)
    return layers


class BoreholeViewer(anywidget.AnyWidget):
    """d3-based geotechnical borehole log: soil-composition bands per
    layer on a shared, zoomable vertical axis, with hover readouts and
    reference-line annotations. Zoom/brush interactions match CPTViewer
    so the two can sit side by side on the same axis. ``layers`` is
    plain dicts from any source; ``layers_from_bhrgt`` (brodata BHR-GT)
    and ``layers_from_bore`` (pygef GEF/BRO XML) are converters for the
    common Dutch formats.
    """

    _esm = _HERE / "static" / "borehole-viewer.js"

    # [{"top", "bottom", "label", "bands": [{"x1", "x2", "color",
    # "hatch"?}, ...], "description"?}, ...] — top/bottom in the current
    # vertical coordinate, bands proportional in x [0, 1], description a
    # free-text detail shown wrapped in the hover readout; see
    # layers_from_bhrgt
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

    def __init__(self, layers=None, *, vertical=None, limits=None, **kwargs):
        """Pythonic facade over the JSON-flat traits.

        ``layers`` — the layer dicts (→ ``layers``), already in the wire
        shape: hand-built, or from :func:`layers_from_bhrgt` /
        :func:`layers_from_bore`. Nothing to tidy here — a borehole log
        has no sample columns.
        ``vertical`` — the vertical coordinate the layers are expressed
        in (→ ``verticalKey``): a key string,
        :class:`~cpt_anywidget.vertical.Vertical` binding, or raw spec
        dict.
        ``limits`` — {verticalKey: (min, max)} axis override
        (→ ``axisLimits``); the pair is oriented to the render
        direction, so callers can pass it either way round.

        Trait names still pass through ``**kwargs`` unchanged; a raw
        ``verticalKey=`` kwarg still counts as the vertical here (it
        orients ``limits``).
        """
        _, traits = _normalize_traits(
            vertical=vertical,
            limits=limits,
            default=kwargs.get(
                "verticalKey", type(self).verticalKey.default_value
            ),
        )
        if layers is not None:
            kwargs["layers"] = list(layers)
        kwargs.update(traits)
        super().__init__(**kwargs)
