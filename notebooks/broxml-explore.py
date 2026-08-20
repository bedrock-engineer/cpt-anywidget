# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "brodata==0.1.8",
#     "cpt-anywidget",
#     "d-geolib-plus",
#     "marimo>=0.24",
#     "pandas==2.3.3",
# ]
#
# [tool.uv.sources]
# cpt-anywidget = { path = "..", editable = true }
# d-geolib-plus = { git = "https://github.com/Deltares/GEOLib-Plus" }
# ///

import marimo

__generated_with = "0.24.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import os
    import pandas as pd

    # hot-reload index.js in place when it changes (needs anywidget[dev])
    os.environ["ANYWIDGET_HMR"] = "1"

    from cpt_anywidget import (
        BoreholeViewer,
        CPTViewer,
        ProfileViewer,
        chainage,
        from_vertical,
        layers_from_bhrgt,
        to_vertical,
    )
    from brodata.cpt import ConePenetrationTest
    from brodata.bhr import GeotechnicalBoreholeResearch

    from geolib_plus.bro_xml_cpt import BroXmlCpt
    from geolib_plus.cpt_utils import merge_thickness
    from geolib_plus.robertson_cpt_interpretation import (
        InterpretationMethod,
        RobertsonCptInterpretation,
        UnitWeightMethod,
    )

    return (
        BoreholeViewer,
        BroXmlCpt,
        CPTViewer,
        ConePenetrationTest,
        GeotechnicalBoreholeResearch,
        InterpretationMethod,
        ProfileViewer,
        RobertsonCptInterpretation,
        UnitWeightMethod,
        chainage,
        from_vertical,
        layers_from_bhrgt,
        merge_thickness,
        mo,
        pd,
        to_vertical,
    )


@app.cell
def _(mo):
    sorted(
        (mo.notebook_dir().parent / "examples" / "broxml-cpt").glob("*.xml")
    )
    return


@app.cell
def _(mo):
    cpt_xml_files = sorted(
        (mo.notebook_dir().parent / "examples" / "broxml-cpt").glob("*.xml")
    )
    file_select = mo.ui.dropdown(
        options={p.name: p for p in cpt_xml_files},
        value=cpt_xml_files[1].name,
        label="CPT file",
    )
    file_select
    return (file_select,)


@app.cell(hide_code=True)
def _(mo):
    bhrgt_xml_files = sorted(
        (mo.notebook_dir().parent / "examples" / "broxml-bhr-gt").glob("*.xml")
    )
    file_select_bhr = mo.ui.dropdown(
        options={p.name: p for p in bhrgt_xml_files},
        value=bhrgt_xml_files[0].name,
        label="Geotechnical borehole file",
    )
    file_select_bhr
    return (file_select_bhr,)


@app.cell
def _(cpt):
    cpt.to_dict()
    return


@app.cell(hide_code=True)
def _(ConePenetrationTest, file_select, mo):
    cpt = ConePenetrationTest(str(file_select.value))
    mo.md(
        f"""
    **{cpt.broId}** — {cpt.description or cpt.deliveryContext}

    | | |
    |---|---|
    | Final depth | {cpt.finalDepth} m |
    | Offset (t.o.v. {cpt.localVerticalReferencePoint or 'referentie'}) | {cpt.offset} m |
    | Quality class | {cpt.qualityClass} |
    | Location (RD) | {cpt.deliveredLocation} |
    | Date | {cpt.researchReportDate.date()} |
    | Predrilled depth | {cpt.predrilledDepth}
    """
    )
    return (cpt,)


@app.cell(hide_code=True)
def _(cpt):
    df = cpt.conePenetrationTest.dropna(axis=1, how='all').sort_index()
    df
    return (df,)


@app.cell
def _(GeotechnicalBoreholeResearch, file_select_bhr, mo):
    gt_borehole = GeotechnicalBoreholeResearch(str(file_select_bhr.value))
    mo.md(
        f"""
    **{gt_borehole.broId}** — { gt_borehole.deliveryContext}

    # 
    """
    )
    return (gt_borehole,)


@app.cell(hide_code=True)
def _(cpt, df, pd):
    # tidy columns straight from brodata: pick the known channels, rename the
    # one awkward BRO name, coerce numeric strings. NaN → None and list
    # conversion happen in the CPTViewer facade, so no hand-scrubbing here
    cpt_data = (
        df.rename(columns={"inclinationResultant": "inclination"})
        .reindex(
            columns=[
                "depth",
                "coneResistance",
                "localFriction",
                "frictionRatio",
                "inclination",
                "porePressureU1",
                "porePressureU2",
            ]
        )
        .apply(pd.to_numeric, errors="coerce")
        .dropna(axis="columns", how="all")
    )

    # vertical coordinate in m NAP: surface elevation minus depth below surface
    cpt_data["nap"] = float(cpt.offset) - cpt_data["depth"]
    return (cpt_data,)


@app.cell(hide_code=True)
def _(cpt_data, mo):
    _options = [k for k in cpt_data if k not in ("depth", "nap")]
    channel_select = mo.ui.multiselect(
        options=_options,
        value=[
            k
            for k in (
                "coneResistance",
                "localFriction",
                "frictionRatio",
                "porePressureU2",
            )
            if k in _options
        ],
        label="channels",
    )
    channel_select
    return (channel_select,)


@app.cell
def _(get_edited_layers, pd):
    pd.DataFrame(get_edited_layers())
    return


@app.cell(hide_code=True)
def _(mo):
    vertical_select = mo.ui.radio(
        options={"depth below surface": "depth", "m NAP": "nap"},
        value="depth below surface",
        label="vertical axis",
    )
    vertical_select
    return (vertical_select,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ### Navigating the chart

    - **zoom** — ctrl/⌘ + scroll, or a trackpad pinch; plain scrolling
      keeps scrolling the page
    - **pan** — drag inside the plot while zoomed in
    - **zoom to a range** — shift-drag a band over it
    - **reset** — double-click the chart

    The same gestures work on the profile and borehole viewers below. In
    the editable layer column (rightmost): **drag** a boundary to move it,
    and use the narrow **structure lane** on the column's outer edge for
    the rest — hover shows a dashed line, **click to split** the layer at
    that depth; near a boundary the lane offers an **× — click to merge**
    the layers it separates (the upper layer wins). **Click** a layer to
    pick its soil class from the pie: click a wedge, flick toward one, or
    walk them with the **arrow keys** and commit with **Enter**.
    """)
    return


@app.cell
def _(mo):
    # groundwater level (m below surface), shared by the GWL annotation
    # and the hydrostatic overlay
    gwl_slider = mo.ui.slider(start=0, stop=10, value=6.9, show_value=True, step=0.1)
    gwl_slider
    return (gwl_slider,)


@app.cell
def _(gwl_slider):
    gwl = gwl_slider.value
    return (gwl,)


@app.cell
def _(at, cpt, gwl):
    # hydrostatic pore pressure below the GWL (0.00981 MPa per m of water
    # column): a polyline in porePressureU2's x coordinate against the
    # shared vertical axis — the overlay only renders while u2 is plotted
    _final = float(cpt.finalDepth)
    hydrostatic = {
        "channel": "porePressureU2",
        "points": [[0, at(gwl)], [0.00981 * (_final - gwl), at(_final)]],
        "color": "#4269d0",
        "dash": "4,3",
    }
    return (hydrostatic,)


@app.cell(hide_code=True)
def _(cpt_interps, mo):
    # seed the editable column from one of the interpretations; starts empty
    seed_select = mo.ui.radio(
        options=[col["label"] for col in cpt_interps],
        label="seed edit column from",
        inline=True
    )
    seed_select
    return (seed_select,)


@app.cell
def _(
    CPTViewer,
    at,
    borehole,
    channel_select,
    cpt,
    cpt_data,
    cpt_interps,
    edited_store,
    from_vertical,
    gwl,
    hydrostatic,
    interpretations,
    seed_select,
    set_edited_layers,
    vertical_select,
):
    # seeding simplifies the interpretation's zones into the widget's base
    # palette (the edit column is a manual 5-class simplification, so e.g.
    # "silt mix" seeds as silt, "stiff fine gr." as clay)
    _seed_class = {
        "sensitive": "clay",
        "organic": "peat",
        "peat": "peat",
        "organic clay": "clay",
        "clay": "clay",
        "silt mix": "silt",
        "sand mix": "sand",
        "sand": "sand",
        "gravelly sand": "gravel",
        "stiff sand": "sand",
        "stiff fine gr.": "clay",
    }

    if edited_store["seed"] != seed_select.value:
        # (re)seed: copy the chosen interpretation's layers, class-keyed so
        # color and label derive from the widget's soil_classes palette; no
        # selection clears the column
        _col = next(
            (c for c in cpt_interps if c["label"] == seed_select.value), None
        )
        edited_store["seed"] = seed_select.value
        edited_store["layers"] = (
            []
            if _col is None
            else [
                {
                    "top": l["top"],
                    "bottom": l["bottom"],
                    "class": _seed_class.get(l["label"], "clay"),
                }
                for l in _col["layers"]
            ]
        )
        set_edited_layers(edited_store["layers"])


    def _on_edit(change):
        # store canonically in depth below surface so edits survive a
        # depth/NAP switch; mirror into mo.state for reactive readers
        _layers = [
            {
                **l,
                "top": from_vertical(l["top"], cpt.offset, vertical_select.value),
                "bottom": from_vertical(l["bottom"], cpt.offset, vertical_select.value),
            }
            for l in change["new"]
        ]
        edited_store["layers"] = _layers
        set_edited_layers(_layers)


    viewer = CPTViewer(
        cpt_data,
        vertical=vertical_select.value,
        channels=channel_select.value,
        interpretations=interpretations,
        borehole=borehole,
        # edit state lives in the notebook in canonical depth; converted to the
        # selected vertical coordinate at the widget boundary like everything else
        editedLayers=[
            {**l, "top": at(l["top"]), "bottom": at(l["bottom"])}
            for l in edited_store["layers"]
        ],
        overlays=[hydrostatic],
        annotations=[
            {"at": at(gwl), "label": "GWL", "color": "#4269d0", "position": "left"},
            {"at": at(cpt.predrilledDepth), "label": "Voorgeboorde diepte", "color": "#000000", "position": "right"},
        ],
    )

    viewer.observe(_on_edit, names="editedLayers")
    viewer
    return


@app.cell
def _(cpt, to_vertical, vertical_select):
    def at(depth_below_surface):
        """Annotation position in the selected vertical coordinate."""
        return to_vertical(depth_below_surface, cpt.offset, vertical_select.value)

    return (at,)


@app.cell
def _(at, cpt_interps):
    # layer boundaries converted to the selected vertical coordinate
    interpretations = [
        {
            "label": col["label"],
            "layers": [
                {**layer, "top": at(layer["top"]), "bottom": at(layer["bottom"])}
                for layer in col["layers"]
            ],
        }
        for col in cpt_interps
    ]
    return (interpretations,)


@app.cell(hide_code=True)
def _(
    BroXmlCpt,
    InterpretationMethod,
    RobertsonCptInterpretation,
    UnitWeightMethod,
    merge_thickness,
):
    # real interpretations via GEOLib+ (Deltares): Robertson (1990,
    # normalized Qtn-Fr chart) and Lengkeek et al. 2022 (non-normalized
    # qt/pa-Rf chart: the organic zone split into peat + organic clay, all
    # zones renumbered, soft-soil boundaries refitted). GEOLib+ reads the
    # BRO XML with its own reader because the interpreter needs its
    # preprocessed CPT object (depth correction, stress profiles, pore
    # pressures) -- brodata stays the source for the plotted channels.
    # Zone labels follow the papers; colors extend the widget's palette
    _ZONES = {
        InterpretationMethod.ROBERTSON: {
            "1": ("sensitive", "#c9b3d6"),
            "2": ("organic", "#8a6642"),
            "3": ("clay", "#78a86c"),
            "4": ("silt mix", "#b5a642"),
            "5": ("sand mix", "#d9cb48"),
            "6": ("sand", "#f4e04d"),
            "7": ("gravelly sand", "#d88c3c"),
            "8": ("stiff sand", "#c9a227"),
            "9": ("stiff fine gr.", "#5e8f68"),
        },
        InterpretationMethod.LENGKEEK_2022: {
            "1": ("sensitive", "#c9b3d6"),
            "2": ("peat", "#8a6642"),
            "3": ("organic clay", "#9c8352"),
            "4": ("clay", "#78a86c"),
            "5": ("silt mix", "#b5a642"),
            "6": ("sand mix", "#d9cb48"),
            "7": ("sand", "#f4e04d"),
            "8": ("gravelly sand", "#d88c3c"),
            "9": ("stiff sand", "#c9a227"),
            "10": ("stiff fine gr.", "#5e8f68"),
        },
    }

    _METHODS = [
        ("Robertson", InterpretationMethod.ROBERTSON, UnitWeightMethod.ROBERTSON),
        (
            "Lengkeek 2022",
            InterpretationMethod.LENGKEEK_2022,
            UnitWeightMethod.LENGKEEK_2022,
        ),
    ]


    def _interpret_one(path, method, unitweight, water_level):
        _cpt = BroXmlCpt()
        _cpt.read(path)
        _cpt.pre_process_data()
        _interp = RobertsonCptInterpretation()
        _interp.interpretation_method = method
        _interp.unitweightmethod = unitweight
        # pore pressures from the given groundwater level, as m NAP
        _interp.user_defined_water_level = True
        _cpt.pwp = float(_cpt.local_reference_level) - water_level
        _cpt.interpret_cpt(_interp)

        # per-sample zones -> display layers: geolib merges sub-0.5 m runs
        # but labels merged spans with every zone crossed ("8/3/5/4"), so
        # resolve each span to its dominant zone by per-sample majority,
        # then fuse neighbours that end up in the same zone
        _bounds, _, _ = merge_thickness(cpt_data=_cpt, min_layer_thick=0.5)
        _samples = list(zip(_cpt.depth, _cpt.lithology))
        _layers = []
        for _j in range(len(_bounds) - 1):
            _top, _bottom = float(_bounds[_j]), float(_bounds[_j + 1])
            _in_span = [z for _d, z in _samples if _top <= _d < _bottom]
            if not _in_span:
                continue
            _label, _color = _ZONES[method][max(set(_in_span), key=_in_span.count)]
            if _layers and _layers[-1]["label"] == _label:
                _layers[-1]["bottom"] = _bottom
            else:
                _layers.append(
                    {"top": _top, "bottom": _bottom, "label": _label, "color": _color}
                )
        return _layers


    def interpret_bro(path, water_level):
        """Both interpretation columns for one BRO CPT XML file.

        Returns [{"label", "layers": [{"top", "bottom", "label", "color"},
        ...]}, ...] with layer boundaries in m depth below surface;
        ``water_level`` is the groundwater level in m NAP.
        """
        return [
            {"label": _label, "layers": _interpret_one(path, _m, _uw, water_level)}
            for _label, _m, _uw in _METHODS
        ]

    return (interpret_bro,)


@app.cell(hide_code=True)
def _(file_select, gwl, interpret_bro):
    # the selected CPT's interpretation columns, driven by the file
    # dropdown and the groundwater slider
    cpt_interps = interpret_bro(file_select.value, gwl)
    return (cpt_interps,)


@app.cell
def _(mo):
    # reactive handle on the editable layer column, for cells that should
    # re-run on every edit (e.g. the DataFrame view)
    get_edited_layers, set_edited_layers = mo.state([])

    # non-reactive twin the viewer cell reads instead, so a drag end does not
    # recreate the widget mid-interaction; layers are canonical depth below
    # surface, "seed" remembers which interpretation the column was seeded from
    edited_store = {"seed": None, "layers": []}
    return edited_store, get_edited_layers, set_edited_layers


@app.cell
def _(gt_borehole, layers_from_bhrgt, vertical_select):
    # the borehole and CPT only share an honest axis in NAP — "depth below
    # surface" is CPT-relative and would mislabel the borehole's layers, so
    # the column only shows on the NAP axis. No conversion needed: NAP is the
    # datum layers_from_bhrgt emits directly
    borehole = (
        {
            "label": gt_borehole.broId,
            "layers": layers_from_bhrgt(gt_borehole, "nap"),
        }
        if vertical_select.value == "nap"
        else {}
    )
    return (borehole,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Length profile

    The profile is wider than the notebook, so it scrolls sideways — the
    **minimap** above it shows where you are: drag the highlighted window,
    or click anywhere on the bar to jump there. Vertical zooming works
    like the CPT chart (ctrl/⌘ + scroll, shift-drag, double-click reset).
    """)
    return


@app.cell(hide_code=True)
def _(ConePenetrationTest, chainage, mo, pd):
    # every sample CPT in one tidy long frame — name + nap + qc + fs per
    # row,
    # the ProfileViewer facade groups rows by the name column — plus
    # chainage positions from the delivered RD coordinates and each CPT's
    # surface level for the maaiveld overlay
    _pairs = [
        (str(p), ConePenetrationTest(str(p)))
        for p in sorted(
            (mo.notebook_dir().parent / "examples" / "broxml-cpt").glob("*.xml")
        )
    ]
    # chainage() walks the coords in the order given, so sort into profile
    # order first — filename order zigzags along this west–east line and
    # would inflate the chainages
    _pairs.sort(key=lambda pc: float(pc[1].deliveredLocation.x))
    _cpts = [_c for _, _c in _pairs]
    _frames = []

    for _c in _cpts:
        _df = _c.conePenetrationTest.apply(pd.to_numeric, errors="coerce")
        _frames.append(
            pd.DataFrame(
                {
                    "name": _c.broId,
                    "nap": float(_c.offset) - _df["depth"],
                    "coneResistance": _df["coneResistance"],
                    "localFriction": _df["localFriction"],
                }
            )
        )
    profile_data = pd.concat(_frames, ignore_index=True)
    profile_positions = chainage(
        {
            _c.broId: (_c.deliveredLocation.x, _c.deliveredLocation.y)
            for _c in _cpts
        }
    )
    surface_levels = {_c.broId: float(_c.offset) for _c in _cpts}
    profile_files = {_c.broId: _p for _p, _c in _pairs}
    return profile_data, profile_files, profile_positions, surface_levels


@app.cell(hide_code=True)
def _(gwl, interpret_bro, profile_files):
    # interpretation columns for every profile CPT, boundaries in
    # canonical depth below surface — converted to NAP only at the widget
    # boundary, like the single-CPT viewer does
    profile_interps = {
        _name: interpret_bro(_path, gwl)
        for _name, _path in profile_files.items()
    }
    return (profile_interps,)


@app.cell(hide_code=True)
def _(mo):
    # which interpretation method colors the profile's layer bars
    profile_interp_select = mo.ui.radio(
        options=["Robertson", "Lengkeek 2022"],
        value="Lengkeek 2022",
        label="profile interpretation",
        inline=True,
    )
    profile_interp_select
    return (profile_interp_select,)


@app.cell(hide_code=True)
def _(profile_interp_select, profile_interps, surface_levels):
    # the strips' layer bars: one interpretation method for the whole
    # profile, picked by the radio; depth-below-surface boundaries become
    # NAP via each CPT's own surface level -- only here, at the widget
    # boundary
    profile_layers = {
        _name: [
            {
                **_l,
                "top": surface_levels[_name] - _l["top"],
                "bottom": surface_levels[_name] - _l["bottom"],
            }
            for _col in _cols
            if _col["label"] == profile_interp_select.value
            for _l in _col["layers"]
        ]
        for _name, _cols in profile_interps.items()
    }
    return (profile_layers,)


@app.cell
def _(
    ProfileViewer,
    profile_data,
    profile_layers,
    profile_positions,
    set_selected_cpt,
    surface_levels,
):
    # the four sample CPTs line up over ~330 m, so true-scale chainage is an
    # honest axis; the toolbar toggle switches to equal spacing. The width
    # deliberately exceeds the notebook cell: the profile scrolls sideways
    # and the overview minimap appears above it. Clicking a strip syncs its
    # name back via `selected`. Each strip's left-edge layer bar shows
    # the interpretation the radio picked
    profile = ProfileViewer(
        profile_data,
        positions=profile_positions,
        channels=["coneResistance", "localFriction"],
        layers=profile_layers,
        overlays=[
            {"levels": surface_levels, "label": "maaiveld", "color": "#8a6642"}
        ],
        height=600,
        width=1000,
    )

    profile.observe(
        lambda change: set_selected_cpt(change["new"]), names="selected"
    )
    profile
    return


@app.cell(hide_code=True)
def _(mo):
    # reactive mirror of the profile's selected strip
    get_selected_cpt, set_selected_cpt = mo.state("")
    return get_selected_cpt, set_selected_cpt


@app.cell(hide_code=True)
def _(get_selected_cpt, mo):
    mo.md(f"""
    Selected strip: **{get_selected_cpt() or '—'}** — click a strip to
    (de)select it.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Geotechnical borehole (BHR-GT)
    """)
    return


@app.cell
def _(BoreholeViewer, gt_borehole, layers_from_bhrgt):
    # the standalone borehole viewer: soil-composition bands per layer,
    # same zoom/hover contract as the CPT chart
    BoreholeViewer(layers=layers_from_bhrgt(gt_borehole, "depth"))
    return


if __name__ == "__main__":
    app.run()
