# cpt-anywidget

[anywidget](https://anywidget.dev)s for geotechnical soundings, built with
plain d3 + TypeScript (no React), developed live inside a marimo notebook.
Three widgets share one zoomable vertical axis model — depth below surface
or elevation in m NAP, selectable:

- `CPTViewer` — CPT measurement channels + read-only interpretation columns
  + a manually editable layer column (drag boundaries; split/merge from
  the hover-previewed structure lane on the column's outer edge; click a
  layer for the soil-class pie — flick or arrow keys + Enter to pick) + a
  nearby geotechnical borehole column, all on the shared axis
- `ProfileViewer` — a length profile: many CPTs as strips anchored by
  chainage on one NAP axis, true-scale ↔ equal spacing toggle, profile-space
  overlays, `selected` strip synced back to Python
- `BoreholeViewer` — a standalone geotechnical borehole log (BHR-GT, GEF):
  soil-composition bands per layer, same zoom/hover contract as `CPTViewer`

## Files

- `src/cpt_anywidget/` — the Python package, **single source of truth for
  the Python API**: `cpt_viewer.py` (traits + constructor facade + `Channel`
  dataclass), `profile_viewer.py` (+ `chainage` helper), `borehole_viewer.py`
  (+ `layers_from_bhrgt`, `layers_from_bore`), `vertical.py` (`Vertical`,
  `to_vertical`,
  `from_vertical`), `intake.py` (`tidy`, `split` — the public data-intake
  seam, pytest'd in `tests/`); `index.css`; `static/` holds the built JS
  bundles
- `js/` — the front end: one entry per widget (`cpt-viewer.ts`,
  `profile-viewer.ts`, `borehole-viewer.ts`) composing shared modules from
  `js/lib/` (channels, cpt-chart, frame, zoom, crosshair, focus-rig,
  layers, editing, layer-edits, lane-target, pie-gesture, pie-menu,
  annotations, overlays,
  strip-layout, chainage-axis, …); colocated `*.test.ts` files are the
  vitest suites; `js/lib/types.ts` is the TS mirror of the trait
  docstrings — change them together
- `CONTEXT.md` — the domain glossary; `docs/adr/` — decisions already
  made, including rejections. Check both before proposing renames or
  architecture changes
- `notebooks/` — live marimo notebooks driving development, one per data
  format (`broxml-explore.py`, `gef-explore.py`, `ags-explore.py`), plus
  `broxml-explore.ipynb`, a Jupyter demo of the same flow
- `examples/broxml-cpt/`, `examples/broxml-bhr-gt/` — sample BRO XML files,
  loaded with `brodata`

## Hard rules

- **Never `Edit`/`Write` a `notebooks/*.py` notebook while a marimo session
  has it open.** The kernel clobbers direct file writes. All notebook changes
  go through the marimo-pair skill (`marimo._code_mode`: `ctx.edit_cell` /
  `ctx.create_cell` / `ctx.run_cell`). Check `ps aux | grep "marimo edit"`
  first — sessions may be open on any of the notebooks.
- Work **incrementally, one small feature per step** — no big-bang rewrites.
  Whole-file replacements get rejected; make targeted edits.
- The user edits the `js/` TypeScript between turns. Always Read a file
  before editing and preserve their changes.

## Dev loop

- `ANYWIDGET_HMR=1` is set in the notebook, but HMR watches the **built**
  bundles in `src/cpt_anywidget/static/` — TS edits reach the browser only
  after `npm run build` (all three entries) or with `npm run dev` running
  (watch mode, **cpt-viewer entry only**). No cell re-runs needed after that.
- Verification after every JS change: `npm run typecheck` (tsc) +
  `npm run test` (vitest); after Python changes: `uv run pytest`.
- Changes to `src/cpt_anywidget/*.py` are NOT hot-reloaded: the kernel holds
  the stale module (needs marimo module-autoreload or a kernel restart).
- Notebook UI (file dropdown, channel multiselect) drives the widgets
  through marimo reactivity — a new widget instance per change; the
  bidirectional traits (`editedLayers`, `selected`) sync back via `observe`
  into a non-reactive store + `mo.state` mirror, never by rebuilding the
  widget mid-interaction.

## Conventions

- **Data contract:** `cptData` is a dict of equal-length lists — tidy
  columns, one row per depth sample, sorted so the first sample renders at
  the top, `None` for missing samples (NaN is invalid JSON and breaks the
  sync). Column names are free-form; the BRO names (`coneResistance`,
  `localFriction`, `frictionRatio`, `porePressureU1`, `porePressureU2`,
  `inclination`) plus `depth`/`nap` get built-in display defaults, any other
  name needs a `channels` binding. The widgets never parse formats or
  convert units — loaders normalize upstream, bindings adapt the chart to
  the data. `intake.tidy`/`intake.split` are the public seam enforcing
  this contract: JSON-safety, equal lengths, render order, nothing else —
  non-numeric samples raise with the column and value named, never
  silently coerce (ADR-0002).
- **Constructor facade:** `CPTViewer(data, vertical=…, channels=…,
  limits=…)` is the preferred call — `data` is a polars/pandas DataFrame or
  dict of columns, run through `intake.tidy` at the boundary (NaN→None,
  numpy scalars unwrapped, rows sorted to render order),
  `vertical`→`verticalKey`,
  `limits`→`axisLimits`, and `channels` mixes strings, `Channel` dataclass
  bindings, and raw dicts. `ProfileViewer(data, positions=…, name=…,
  channel=…)` takes tidy *long* data with a name column and `{name:
  chainage}` positions (`chainage()` computes them from map coordinates).
  `BoreholeViewer(layers, vertical=…, limits=…)` takes wire-shape layer
  dicts untouched (no sample columns to tidy).
  The vertical/channels/limits normalization is shared by all facades via
  `intake._normalize_traits` (tested through the constructors in
  `tests/test_facade.py`); a raw `verticalKey=` kwarg still counts as the
  vertical there. Trait names still pass through as kwargs unchanged; the
  traits stay the JSON wire format.
- **Vertical axis:** `verticalKey` selects which data column is the vertical
  coordinate — `depth` (below surface, positive down) or `nap` (`surface
  offset − depth`, positive up, computed Python-side so the widgets never
  see datums); a `Vertical` spec binds any other column. The front end is
  direction-agnostic: the y domain follows data order and hover bisects in
  that direction. Annotation `at`, layer `top`/`bottom`, and the vertical
  `axisLimits` entry are all expressed in the selected coordinate — the
  notebook converts via `to_vertical`/`from_vertical`, only at the widget
  boundary.
- **d3 style:** everything renders as a function of the current (zoomed)
  vertical scale. A `js/lib` module builds its nodes once (keyed
  `.join()`s, static attrs at join time) and returns a `Placer` —
  `place(y1)` — only dynamic values update per pointermove/zoom.
  `verticalZoom` is the zoom drive, shaped like a d3 component:
  `verticalZoom().scale(y).xExtent(x).placers([…])`, applied with
  `svg.call(vz)` in any order (the brush overlay re-raises and re-fits
  itself on pointerenter). The vertical gesture band is the scale's
  range; `xExtent` takes a pair or a function re-read per gesture, so
  live widths (the profile's spacing toggle) never go stale. It runs
  the initial placement, re-places on every zoom, and event handlers
  read `vz.currentScale()` — valid before apply — for hit tests;
  entries never keep their own `zy`. `cpt-chart.ts` is the chart core (series,
  stacked x axes, grids, y axis, curves) that `cpt-viewer.ts` composes
  columns/overlays/editing onto. Crosshairs share only their skin
  (`focus-rig`); hover semantics stay per widget (ADR-0001).
  Per-instance clipPath ids via `crypto.randomUUID()` (`frame.plotClip`).
- **Axis semantics:** explicit `axisLimits` are honored exactly (no
  `.nice()`); the data-driven fallback is niced with a zero floor.
- **Layout:** bottom axes read left-to-right (qc, fs, u1, u2), top axes
  right-to-left (Rf, incl), stacked outward in 30px slots; margins derive
  from the filtered series count. Layer columns (72px + 8px gap, no x axis)
  widen the svg beyond `width`, driven by a single `columns` descriptor
  array in `cpt-viewer.ts`: the borehole column (`side: "left"`) sits left
  of the plot at negative x (the viewBox origin shifts, plot coordinates
  stay put), interpretation columns then the edit column stack to the
  right, all rendered by the shared `layerColumn` function. Borehole layers
  carry `bands` (proportional x in [0, 1], optional matplotlib-style
  `hatch` chars rendered as SVG patterns) instead of a single fill. The
  edit column's `gapBefore` leaves one slot **deliberately empty** — the
  visual separator between the read-only interpretation columns and the
  editable one. The borehole column only shows in NAP mode (the notebook
  passes `{}` otherwise): NAP is the only datum the two objects genuinely
  share — "depth below surface" is CPT-relative and would mislabel the
  borehole's layers.
- **Soil classes:** the `soil_classes` palette `[{name, color, label?}]` is
  the single source of truth for layer colors — layers reference an entry
  via their `class` key, which drives both fill and label; explicit
  `color`/`label` on a layer are only fallbacks for classless layers.
- **Edit state:** the notebook owns the edited layers, in canonical depth
  below surface — a non-reactive `edited_store` dict the viewer cell reads
  (so a drag end never rebuilds the widget) plus a `mo.state` mirror for
  reactive readers. The column always renders; while empty it offers a
  click-to-start placeholder that creates one classless layer spanning the
  sounding, and a `seed_select` radio seeds it from one of the
  interpretations (re-selecting re-seeds, discarding edits).
  Front-end edits are pure operations in `layer-edits.ts` (seed/drag/split/
  merge/assign class; clamped to `minThickness`, same-reference return =
  no-op), and the gesture decisions are pure too: the structure lane's
  zone rule lives in `lane-target.ts`, the pie's press-drag-release
  state machine in `pie-gesture.ts` (input events in, commands out);
  pie wedge picks hit-test d3.pie's own arc datums (`pie-menu.ts`).
  `editing.ts` is the DOM adapter feeding events to the decisions and
  executing the returned commands.
- **Profile strips:** `stripLayout` anchors strips at true chainage,
  growing the svg past `width` only when strips would collide; equal
  spacing spreads them over the requested width. The layout owns the
  spacing mode — `equalSpacing()` is a scale-style get-set accessor and
  `centers()`/`width()`/`distX()` serve the active geometry — so the
  entry keeps no copies: placers, hit tests and the chainage axis read
  the layout live, and the frame factories (`yGridFor`, `yAxisRightFor`)
  take a width thunk for the same reason. Tied chainages dodge around a
  shared anchor and read as one dijkpaal on the chainage axis.
  Profile overlays are `points` polylines in (chainage, vertical) space or
  per-strip `levels` (flat across each strip, sloping connectors between).
- The widgets stay open systems: overlay features (`annotations`,
  `overlays`) take data via traits and render as a function of the vertical
  scale, so they track zoom.
