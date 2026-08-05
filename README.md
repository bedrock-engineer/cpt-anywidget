# cpt-anywidget

[anywidget](https://anywidget.dev) viewers for cone penetration tests (CPT)
and geotechnical boreholes from the Dutch [BRO](https://basisregistratieondergrond.nl/),
rendered with plain d3. Built for notebook use (marimo, Jupyter). Every
viewer shares a zoomable vertical axis in depth below surface or elevation
(m NAP), so soundings, borehole logs, and interpretations line up.

## Viewers

- **`CPTViewer`** — one CPT: measurement channels (qc, fs, Rf, u1/u2,
  inclination, …) against the vertical axis, plus optional layer columns:
  a nearby borehole log, read-only interpretation columns (e.g. Robertson,
  Lengkeek), and an editable layer column synced back to Python.
- **`BHRGTViewer`** — a single borehole log with proportional
  soil-composition bands and hatch patterns; `layers_from_bhrgt` converts a
  `brodata` BHR-GT object into its `layers` trait.
- **`ProfileViewer`** — multiple CPTs side by side along a chainage axis
  (a cross-section); `chainage` computes along-profile distances from map
  coordinates.

## Install

Not on PyPI yet, install from git:

```sh
uv add "cpt-anywidget @ git+https://github.com/bedrock-engineer/cpt-anywidget"
```

The `bro` extra (`cpt-anywidget[bro]`) pulls in `brodata`, needed only for
`layers_from_bhrgt`.

## Usage

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
equal-length lists — one row per depth sample. The widget never parses file
formats or converts units: loaders (e.g. [brodata](https://pypi.org/project/brodata/))
normalize upstream. BRO column names get built-in display defaults; any
other column can be bound with `Channel(key, label=…, unit=…, color=…, side=…)`.
Custom vertical datums work the same way via `Vertical(key, label=…, up=…)`.

Scroll/drag to zoom and pan the vertical axis; hover for a synced readout
across all channels. Annotations, overlays, and axis limits are plain
traits and track the zoom.

## Development

Front end (TypeScript, `js/`) builds into `src/cpt_anywidget/static/`:

```sh
npm install
npm run build     # or: npm run dev (watch mode)
```

Live development happens in `notebooks/cpt-explore.py` with marimo:

```sh
uv run marimo edit notebooks/cpt-explore.py
```

Set `ANYWIDGET_HMR=1` so JS edits hot-reload in the browser. Sample BRO XML
files live in `examples/`.
