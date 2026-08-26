# cpt-anywidget



[![PyPI](https://img.shields.io/pypi/v/cpt-anywidget)](https://pypi.org/project/cpt-anywidget/)
[![Python versions](https://img.shields.io/pypi/pyversions/cpt-anywidget)](https://pypi.org/project/cpt-anywidget/)
[![License](https://img.shields.io/pypi/l/cpt-anywidget)](https://github.com/bedrock-engineer/cpt-anywidget/blob/main/LICENSE)

<a href="https://bedrock.engineer">
<img src="https://bedrock.engineer/Bedrock_TextRight.png" width="300px" alt="Bedrock Logo" />
</a>

[anywidget](https://anywidget.dev) viewers for cone penetration test (CPT)
and geotechnical borehole data, rendered with [D3.js](https://d3js.org/). Built for notebook use
([marimo](https://marimo.io/), [Jupyter](https://jupyter.org/)). Every viewer shares a zoomable vertical axis in depth below surface or elevation, so soundings, borehole logs, and interpretations line up.

Full documentation on [bedrock.engineer/docs/cpt-anywidget](https://bedrock.engineer/docs/cpt-anywidget)

![CPTViewer showing CPT measurement channels next to interpretation and layer columns](https://raw.githubusercontent.com/bedrock-engineer/cpt-anywidget/main/example.svg)


## Viewers

- **[`CPTViewer`](https://bedrock.engineer/docs/cpt-anywidget/reference/cpt-viewer/)** — one CPT: measurement channels (qc, fs, Rf, u1/u2,
  inclination, …) against the vertical axis, plus optional layer columns:
  a nearby borehole log, read-only interpretation columns (e.g. Robertson,
  Lengkeek), and an editable layer column synced back to Python.
- **[`BoreholeViewer`](https://bedrock.engineer/docs/cpt-anywidget/reference/borehole-viewer/)** — a single borehole log with proportional
  soil-composition bands and hatch patterns; its `layers` trait takes
  plain dicts from any source, and `layers_from_bhrgt` (brodata BHR-GT)
  and `layers_from_bore` (pygef GEF/BRO XML) convert boreholes already
  in the Dutch BRO soil vocabulary.
- **[`ProfileViewer`](https://bedrock.engineer/docs/cpt-anywidget/reference/profile-viewer/)** — multiple CPTs side by side along a chainage axis
  (a cross-section); `chainage` computes along-profile distances from map
  coordinates.

## [Install](https://bedrock.engineer/docs/cpt-anywidget/getting-started/)

From [PyPI](https://pypi.org/project/cpt-anywidget/), with
[uv](https://docs.astral.sh/uv/) (recommended):

```sh
uv add cpt-anywidget
```

or with pip: `pip install cpt-anywidget`.

## [Usage](https://bedrock.engineer/docs/cpt-anywidget/getting-started/#minimal-example)

```python
import polars as pl
from cpt_anywidget import CPTViewer, Channel

df = pl.DataFrame({
    "depth": [0.0, 0.02, 0.04],        # or "nap" for elevation
    "coneResistance": [0.1, 0.4, 0.9],  # MPa
    "localFriction": [0.01, 0.02, 0.02],
})

CPTViewer(df, vertical="depth", channels=["coneResistance", "localFriction"])
```

`data` is [tidy](https://data.europa.eu/apps/data-visualisation-guide/intro-to-tidy-data) columns — a polars or pandas DataFrame or a dict of
columns (lists, tuples, numpy arrays) — one row per depth sample. The widget never parses file
formats or converts units: loaders (e.g. [brodata](https://pypi.org/project/brodata/))
normalize upstream. The Dutch BRO column names get built-in display
defaults; any
other column can be bound with
[`Channel(key, label=…, unit=…, color=…, side=…)`](https://bedrock.engineer/docs/cpt-anywidget/reference/cpt-viewer/).
Custom vertical datums work the same way via
[`Vertical(key, label=…, up=…)`](https://bedrock.engineer/docs/cpt-anywidget/reference/vertical/).

Annotations, overlays, and axis limits are plain traits and track the
zoom. See [Interactions](#interactions) for the pointer and keyboard
gestures.

## Interactions

### [Zoom and pan — all viewers](https://bedrock.engineer/docs/cpt-anywidget/getting-started/#use-the-viewer)

- To zoom the vertical axis, hold the <kbd>Ctrl</kbd> key (<kbd>Cmd</kbd> on macOS) and turn
  the mouse wheel. Pinching on a trackpad or touch device zooms too, without keys.
- To pan a zoomed axis, drag in the plot area.
- To zoom to a range, hold the Shift key and drag along the axis.
- To reset the zoom, double-click in the plot area.
- Move the pointer across the plot to read the values at that depth.
- The mouse wheel without a modifier key scrolls the notebook, not the
  chart.

### [Edit layers — the CPTViewer edit column](https://bedrock.engineer/docs/cpt-anywidget/edit-layers/)

- To move a boundary, drag it. A boundary stops at the minimum layer
  thickness.
- To split a layer, click in the lane beside the column. A dashed line
  previews where the new boundary goes.
- To merge two layers, move the pointer near their boundary in the lane
  and click the × it offers. The upper layer keeps its class.
- To set the class of a layer, click the layer. A pie menu opens. Click
  a wedge, or walk the wedges with the arrow keys and push Enter.
- As a fast path, press the layer, drag toward a wedge, and release.
- To close the pie menu, push the Escape key or click outside the menu.
- Each edit goes back to Python through the `editedLayers` trait.

### [Select a strip — ProfileViewer](https://bedrock.engineer/docs/cpt-anywidget/reference/profile-viewer/)

- To select a CPT strip, click it. The name shows in the `selected`
  trait in Python.
- To deselect the strip, click it again.

## Development

Front end (TypeScript, `js/`) builds into `src/cpt_anywidget/static/`:

```sh
npm install
npm run build     # or: npm run dev (watch mode)
```

Set `ANYWIDGET_HMR=1` so JS edits hot-reload in the browser. Sample files
(BRO XML, GEF, AGS) live in `examples/`.

## License

[Apache-2.0](https://github.com/bedrock-engineer/cpt-anywidget/blob/main/LICENSE).
