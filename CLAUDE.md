# cpt-anywidget

An [anywidget](https://anywidget.dev) for cone penetration test (CPT) charts:
measurement channels plotted against a shared, zoomable vertical axis —
depth below surface or elevation in m NAP, selectable. Built with plain d3
(no React, no build step). Developed live inside a marimo notebook.

End goal: CPT measurement column(s) + multiple read-only interpretation
columns (Robertson, Lengkeek) + one manually editable layer column + a nearby
geotechnical borehole for comparison, all sharing the NAP axis.
Interpretation columns render via the `interpretations` trait (dummy data so
far). The editable column renders via the bidirectional `editedLayers` trait
(display only so far — front-end editing interactions and a `soil_classes`
palette are still to come).

## Files

- `cpt_viewer.py` — the widget class, **single source of truth** for the
  Python API (traits: `cptData`, `verticalKey`, `axisLimits`, `annotations`,
  `interpretations`, `editedLayers`, `borehole`, `channels`, `width`,
  `height`), plus the Pythonic constructor facade and the `Channel`
  dataclass (see Data contract)
- `index.js` — the entire front end; `index.css` is empty but wired up
- `cpt-explore.py` — live marimo notebook driving development; imports
  `CPTViewer` from `cpt_viewer.py`
- `broxml-cpt/` — sample BRO XML CPT files, loaded with `brodata`
- `cpt-viewer.py` (hyphenated) — stale anywidget tutorial leftover, ignore

## Hard rules

- **Never `Edit`/`Write` `cpt-explore.py` while a marimo session is running.**
  The kernel clobbers direct file writes. All notebook changes go through the
  marimo-pair skill (`marimo._code_mode`: `ctx.edit_cell` / `ctx.create_cell`
  / `ctx.run_cell`).
- Work **incrementally, one small feature per step** — no big-bang rewrites.
  Whole-file replacements get rejected; make targeted edits.
- The user edits `index.js` between turns. Always Read it before editing and
  preserve their changes.

## Dev loop

- `ANYWIDGET_HMR=1` is set in the notebook, so **`index.js` edits hot-reload
  in the browser** — no cell re-runs needed after JS changes.
- Changes to `cpt_viewer.py` are NOT hot-reloaded: the kernel holds the stale
  module (needs marimo module-autoreload or a kernel restart).
- Notebook UI (file dropdown, channel multiselect) drives the widget through
  marimo reactivity — a new widget instance per change, no JS trait listeners.

## Conventions

- **Data contract:** `cptData` is a dict of equal-length lists — tidy
  columns, one row per depth sample, sorted by depth, `None` for missing
  samples (NaN is invalid JSON and breaks the sync). Column names are
  free-form; the BRO names (`coneResistance`, `localFriction`,
  `frictionRatio`, `porePressureU1`, `porePressureU2`, `inclination`) plus
  `depth`/`nap` get built-in display defaults, any other name needs a
  `channels` binding. The widget never parses formats or converts units —
  loaders normalize upstream, bindings adapt the chart to the data.
- **Constructor facade:** `CPTViewer(data, vertical=…, channels=…,
  limits=…)` is the preferred call — `data` is a DataFrame or dict of
  columns (NaN→None and numpy scalars sanitized at the boundary),
  `vertical`→`verticalKey`, `limits`→`axisLimits`, and `channels` mixes
  strings, `Channel` dataclass bindings, and raw dicts. Trait names still
  pass through as kwargs unchanged; the traits stay the JSON wire format.
- **Vertical axis:** `verticalKey` selects which `cptData` column is the
  vertical coordinate — `depth` (below surface, positive down) or `nap`
  (`surface offset − depth`, positive up, computed Python-side so the widget
  never sees datums). The front end is direction-agnostic: the y domain
  follows data order (first sample at the top) and hover bisects in that
  direction. Annotation `at` values and the vertical `axisLimits` entry are
  expressed in the selected coordinate — the notebook converts. NAP is what
  lets a future nearby borehole share the axis.
- **d3 style:** everything is a function of the current (zoomed) scale `zy`;
  keyed joins on the shared `series` array; static attrs at join time, only
  dynamic values updated per pointermove/zoom; per-instance clipPath ids via
  `crypto.randomUUID()`.
- **Axis semantics:** explicit `axisLimits` are honored exactly (no
  `.nice()`); the data-driven fallback is niced with a zero floor.
- **Layout:** bottom axes read left-to-right (qc, fs, u1, u2), top axes
  right-to-left (Rf, incl), stacked outward in 30px slots; margins derive
  from the filtered series count. Layer columns (72px + 8px gap, no x axis)
  widen the svg beyond `width`, driven by a single `columns` descriptor
  array in `index.js`: the borehole column (`side: "left"`) sits left of
  the plot at negative x (the viewBox origin shifts, plot coordinates stay
  put), interpretation columns then the edit column stack to the right, all
  rendered by the shared `layerColumn` function. Borehole layers carry
  `bands` (proportional x in [0, 1], optional matplotlib-style `hatch`
  chars rendered as SVG patterns) instead of a single fill. The edit
  column's `gapBefore` leaves one slot **deliberately empty** — the visual
  separator between the read-only interpretation columns and the editable
  one. Layer `top`/`bottom` values are in the current vertical coordinate,
  converted notebook-side like annotation `at`. The borehole column only
  shows in NAP mode (the notebook passes `{}` otherwise): NAP is the only
  datum the two objects genuinely share — "depth below surface" is
  CPT-relative and would mislabel the borehole's layers.
- **Edit state:** the notebook owns the edited layers, in canonical depth
  below surface — a non-reactive `edited_store` dict the viewer cell reads
  (so a drag end never rebuilds the widget) plus a `mo.state` mirror for
  reactive readers. The column starts empty; a `seed_select` radio seeds it
  from one of the interpretations (re-selecting re-seeds, discarding edits).
  Conversion to/from the selected vertical coordinate happens only at the
  widget boundary, via `vertical.to_vertical` / `vertical.from_vertical`.
- The widget stays an open system: overlay features (annotations) take data
  via traits and render as a function of the depth scale, so they track zoom.
