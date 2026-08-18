* Soil-class vocabulary: `soil_classes` (5 English classes) vs BRO
  `geotechnicalSoilName` (klei, zand, sterkZandigSilt, ...) — decide the
  editing vocabulary before seeding `editedLayers` from Robertson

## Code

* Extract the JS into an environment-agnostic library: each entry becomes a
  `createCptViewer(el, props, callbacks)` factory (props = the trait JSON,
  already the wire format; callbacks replace the two model.set sites —
  `editedLayers`, `selected`), the anywidget entries shrink to ~15-line
  adapters; vite lib build, d3 as peer deps, ship the CSS. The update model
  stays rebuild-per-props (as the notebook already works). React wrapper
  on top once the factories exist. The 2026-08-12 architecture pass did the
  groundwork (zoom drive owns the placer loop, pure ops in layer-edits/
  pie-menu, focus-rig) — what remains is the factory signature and build.
* BHR-GT (work in progress): align its intake with ADR-0002 —
  `layers_from_bhrgt` still parses brodata objects in-package and
  `to_vertical` still coerces numeric strings; decide whether the borehole
  path gets its own `tidy`-style seam or moves out.

## Plot

### CPT

* Dissipation test data?

### Profile

* Rotation for labels of boreholes & cpt's in profile
* Borehole strips: mix boreholes into the profile at their chainage —
  separate `boreholes` trait (layer lists don't fit the long df). For bhr-gt, reuse the
  band/hatch rendering at strip width; stripLayout needs a per-strip kind
  (curve + axis vs bands, no axis); `selected` reports them too
* Overlay fills: area variant on `ProfileOverlay` — `points` + `points2`
  (two horizons) filled between, or `fill` closing down to the view
  bottom. Covers geological cross-sections (GeoTOP/REGIS), cut/fill vs
  design profile, water bodies. Render behind the strips (fills are
  ground, CPTs are figure), lines in front
* Crossings/features lane: `features` trait of chainage intervals and
  points (`{from, to?, label, kind?}` — no `to` = point marker) for
  roads, buildings, cables & pipelines (KLIC), monitoring wells. Render
  as labeled bars in a margin lane by the chainage axis (lengteprofiel
  information-band convention), NOT as bands through the plot — no
  vertical extent in NAP. Optional per-feature faint vertical guide,
  opt-in. Must share the chainage→px mapping with `points` overlays
  (factor it out) so equal spacing keeps the lane registered
* Overlay usability layer (keeps the above from getting messy):
  - legend with visibility toggles, front-end only view state (entries
    from `label`, no trait) — biggest win once 4+ overlays
  - crosshair readout reports each overlay's value at the cursor's
    chainage — hover instead of ink
  - overlay line labels at the right edge, through `dodgeLabels`; never
    mid-plot
  - hold the salience defaults: strips are figure, overlays are
    reference (thin/muted/dashed, low-alpha fills)
* No plugin/arbitrary-draw escape hatch: breaks the wire-format contract
  and the JS-library extraction; an uncovered case defines the next
  primitive instead


* GeoTOP or REGIS integration demo, like https://github.com/cfuentealba/xsboringen/blob/master/xsboringen/examples/example_solids/doorsnede/cross_section_A.png
* https://github.com/cfuentealba/xsboringen/blob/master/xsboringen/examples/example_regis/doorsnede/cross_section_A.png

#### Interaction
