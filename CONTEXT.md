# cpt-anywidget

Viewers for geotechnical soundings — CPT measurement channels, borehole
logs, and length profiles — where an engineer reads soil layering
against the measurements and manually refines an interpreted layering.

## Language

**Layer**:
A contiguous vertical interval of soil in an interpretation, bounded by
a top and a bottom in the current vertical coordinate.

**Boundary**:
The edge two adjacent layers share — the upper layer's bottom and the
lower layer's top are the same value, in either vertical orientation.
_Avoid_: edge, divider

**Layer edit**:
One of the four legal transformations of the edited layering: move a
boundary, split a layer, merge two layers across a boundary, assign a
soil class. Every edit keeps neighbours sharing their boundary and no
layer thinner than the minimum thickness.
_Avoid_: mutation, change

**Structure lane**:
The persistent strip along the edit column's outer edge where the
boundary-structure edits live, each previewed on hover before a click
commits: an × on a nearby boundary merges it away, a dashed insertion
line anywhere else splits the layer at that depth. Zones keep clicks
unambiguous — lane: structure, layer body: classify, boundary strip:
move.
_Avoid_: gutter, toolbar

**Soil-class pie**:
The radial picker for assigning a layer's soil class: equal wedges at
fixed angles in palette order, the first centered on 12 o'clock, so
picks can become muscle memory.
_Avoid_: palette popup, radial menu, pie chart

**Wedge**:
One soil class's slice of the soil-class pie. Past the pie's dead zone
only bearing matters — releasing anywhere along a wedge's direction
picks its class.
_Avoid_: slice, sector

**Spacing mode**:
How the profile anchors its strips horizontally. True scale places each
strip at its real chainage, so the axis reads honest meters; equal
spacing spreads the strips evenly over the requested width, and the
axis degrades to per-anchor labels. One strip layout owns both
geometries and the active mode — consumers read it live.
_Avoid_: layout mode, scale mode

**Dijkpaal**:
A numbered marker post along a dike, the chainage reference for
soundings. Soundings at the same chainage (crest and toe of one
dijkpaal) tie; their strips dodge around a shared anchor so they read
as one location on the chainage axis.

**Crosshair**:
The hover companion: a rule across the plot at the pointer's vertical
position with the vertical value read out on the axis. What a hover
*hits* differs per viewer — the CPT viewer snaps to the nearest sample,
the borehole log reads the containing layer, the profile reads bare
position — and that difference is deliberate, not drift.
_Avoid_: tooltip, cursor
