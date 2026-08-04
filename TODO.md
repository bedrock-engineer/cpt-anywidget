* ~~Look at the real scheldestromen notebook!~~ integrated in
  N27-2/notebook/gwl_from_cptu_mo.py — its `depth` column is NAP elevation,
  so the adapter renames it to `nap`; the Python facade now sorts/validates
  data on ingest so the front end's first-sample-on-top contract is real
* Don't hardcode column names in anywidget
* Soil-class vocabulary: `soil_classes` (5 English classes) vs BRO
  `geotechnicalSoilName` (klei, zand, sterkZandigSilt, ...) — decide the
  editing vocabulary before seeding `editedLayers` from Robertson

## Code

* ~~Organise, Move to functions. more .call() pattern?~~ split into js/lib/
  modules (a component builds its nodes, returns a place(y) the zoom loop
  drives), bundled per entry with vite into src/cpt_anywidget/static/
* ~~Length-profile widget: strips as facets in one svg on a shared NAP scale,
  fx = chainage (linear ↔ band toggle for true-scale/equal-spaced), qc-only
  strips with frame + own axis, profile-space overlays (GWL, maaiveld)~~
  `ProfileViewer` (js/profile-viewer.ts + profile_viewer.py): tidy long df
  + `positions=` chainage (`chainage()` helper from map coords), `selected`
  trait syncs the clicked strip for composing with the full CPTViewer
* ~~Wire ProfileViewer into gwl_from_cptu_mo.py: profile of the N27 CPTs with
  GWL + maaiveld overlays, `selected` opens the CPTViewer beside it~~ profile
  follows the map selection, chainage = `ref_distance`, maaiveld as per-strip
  `levels` overlay (flat over each strip, sloping connectors)

## Plot

* [Macrostrat column style annotating thin layers](https://staging.macrostrat.org/columns/114)

### CPT

* ~~Add depth domain input from python~~ `axisLimits[verticalKey]` / `limits=`
* CPT plot pre-excavated layers?
* ~~Pore pressure hydrostatic line~~ generalized as the `overlays` trait:
  polylines in (channel x, vertical y) space
* Separate plots side by side
* Minimap toggle


* Dissipation test data?

## Geotechnische Boringen

* Layers

## Geinterpreteerde CPT's

* Editing layers
  * Remove layers
  * Change layers soil type
  * Add layer


https://deltares.github.io/GEOLib-Plus/latest/community/tutorials/tutorial_custom_cpt_interpretation.html