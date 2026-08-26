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
app = marimo.App(width="columns")


@app.cell(column=0, hide_code=True)
def _(mo):
    mo.md("""
    # cpt-anywidget

    Interactive CPT, borehole and profile widgets for Python notebooks.
    """)
    return


@app.cell
def _():
    import marimo as mo
    import pandas as pd

    from cpt_anywidget import (
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
def _(ConePenetrationTest, GeotechnicalBoreholeResearch, mo):
    # one fixed CPT and one fixed geotechnical borehole from the sample data
    _cpt_files = sorted(
        (mo.notebook_dir().parent / "examples" / "broxml-cpt").glob("*.xml")
    )
    _bhr_files = sorted(
        (mo.notebook_dir().parent / "examples" / "broxml-bhr-gt").glob("*.xml")
    )
    cpt_file = str(_cpt_files[1])
    cpt = ConePenetrationTest(cpt_file)
    gt_borehole = GeotechnicalBoreholeResearch(str(_bhr_files[0]))
    return cpt, cpt_file, gt_borehole


@app.cell
def _(cpt, pd):
    # tidy columns straight from brodata: pick the known channels, rename the
    # one awkward BRO name, coerce numeric strings
    _df = cpt.conePenetrationTest.dropna(axis=1, how="all").sort_index()
    cpt_data = (
        _df.rename(columns={"inclinationResultant": "inclination"})
        .reindex(
            columns=[
                "depth",
                "coneResistance",
                "localFriction",
                "frictionRatio",
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


@app.cell
def _(cpt, to_vertical):
    # groundwater level in m below surface, fixed for the demo
    gwl = 6.9

    def at(depth_below_surface):
        """Annotation position in m NAP."""
        return to_vertical(depth_below_surface, cpt.offset, "nap")

    return at, gwl


@app.cell
def _(at, cpt, gwl):
    # hydrostatic pore pressure below the GWL (0.00981 MPa per m of water
    # column): a polyline in porePressureU2's x coordinate against the
    # shared vertical axis
    _final = float(cpt.finalDepth)
    hydrostatic = {
        "channel": "porePressureU2",
        "points": [[0, at(gwl)], [0.00981 * (_final - gwl), at(_final)]],
        "color": "#4269d0",
        "dash": "4,3",
    }
    return (hydrostatic,)


@app.cell(hide_code=True)
def _(
    BroXmlCpt,
    InterpretationMethod,
    RobertsonCptInterpretation,
    UnitWeightMethod,
    merge_thickness,
):
    # real interpretations via GEOLib+ (Deltares): Robertson (1990) and
    # Lengkeek et al. 2022. Zone labels follow the papers; colors extend the
    # widget's palette
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

        # per-sample zones to display layers: geolib merges sub-0.5 m runs but
        # labels merged spans with every zone crossed ("8/3/5/4"), so resolve
        # each span to its dominant zone by per-sample majority, then fuse
        # neighbours that end up in the same zone
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


@app.cell
def _(cpt_file, gwl, interpret_bro):
    cpt_interps = interpret_bro(cpt_file, gwl)
    return (cpt_interps,)


@app.cell
def _(at, cpt_interps, gt_borehole, layers_from_bhrgt):
    # layer boundaries converted to NAP; only the Robertson column shows in
    # the viewer. The borehole column shares the NAP axis directly: NAP is
    # the datum layers_from_bhrgt emits
    interpretations = [
        {
            "label": col["label"],
            "layers": [
                {**layer, "top": at(layer["top"]), "bottom": at(layer["bottom"])}
                for layer in col["layers"]
            ],
        }
        for col in cpt_interps
        if col["label"] == "Robertson"
    ]
    borehole = {
        "label": gt_borehole.broId,
        "layers": layers_from_bhrgt(gt_borehole, "nap"),
    }
    return borehole, interpretations


@app.cell
def _(mo):
    # reactive handle on the editable layer column, for cells that should
    # re-run on every edit (the DataFrame view in the second column)
    get_edited_layers, set_edited_layers = mo.state([])

    # non-reactive twin the viewer cell reads instead, so a drag end does not
    # recreate the widget mid-interaction; layers are canonical depth below
    # surface, "seed" remembers whether the column was seeded already
    edited_store = {"seed": None, "layers": []}
    return edited_store, get_edited_layers, set_edited_layers


@app.cell(hide_code=True)
def _(
    CPTViewer,
    at,
    borehole,
    cpt,
    cpt_data,
    cpt_interps,
    edited_store,
    from_vertical,
    gwl,
    hydrostatic,
    interpretations,
    set_edited_layers,
):
    # seed the editable column once from the Robertson interpretation,
    # simplified into the widget's base palette (e.g. "silt mix" seeds as
    # silt, "stiff fine gr." as clay)
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

    if edited_store["seed"] != "Robertson":
        _col = next((c for c in cpt_interps if c["label"] == "Robertson"), None)
        edited_store["seed"] = "Robertson"
        edited_store["layers"] = [
            {
                "top": l["top"],
                "bottom": l["bottom"],
                "class": _seed_class.get(l["label"], "clay"),
            }
            for l in (_col["layers"] if _col else [])
        ]
        set_edited_layers(edited_store["layers"])


    def _on_edit(change):
        # store canonically in depth below surface; mirror into mo.state for
        # reactive readers
        _layers = [
            {
                **l,
                "top": from_vertical(l["top"], cpt.offset, "nap"),
                "bottom": from_vertical(l["bottom"], cpt.offset, "nap"),
            }
            for l in change["new"]
        ]
        edited_store["layers"] = _layers
        set_edited_layers(_layers)


    viewer = CPTViewer(
        cpt_data,
        vertical="nap",
        channels=[
            "coneResistance",
            "localFriction",
            "frictionRatio",
            "porePressureU2",
        ],
        interpretations=interpretations,
        borehole=borehole,
        editedLayers=[
            {**l, "top": at(l["top"]), "bottom": at(l["bottom"])}
            for l in edited_store["layers"]
        ],
        overlays=[hydrostatic],
        annotations=[
            {"at": at(gwl), "label": "GWL", "color": "#4269d0", "position": "left"},
        ],
    )

    viewer.observe(_on_edit, names="editedLayers")
    viewer
    return


@app.cell(hide_code=True)
def _(ConePenetrationTest, chainage, mo, pd):
    # the four sample CPTs that line up over ~330 m (the other samples sit
    # tens of km away and would stretch the profile) in one tidy long frame
    # (name + nap + channels per row), plus chainage positions from the
    # delivered RD coordinates and each CPT's surface level for the
    # maaiveld overlay. chainage() walks the coords in the order given, so
    # sort into profile order first
    _line = {
        "CPT000000090040",
        "CPT000000090074",
        "CPT000000090096",
        "CPT000000090155",
    }
    _pairs = [
        (str(p), ConePenetrationTest(str(p)))
        for p in sorted(
            (mo.notebook_dir().parent / "examples" / "broxml-cpt").glob("*.xml")
        )
        if p.stem in _line
    ]
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
def _(gwl, interpret_bro, profile_files, surface_levels):
    # one interpretation method (Lengkeek 2022) colors every strip's layer
    # bar; depth-below-surface boundaries become NAP via each CPT's own
    # surface level, only here at the widget boundary
    profile_layers = {
        _name: [
            {
                **_l,
                "top": surface_levels[_name] - _l["top"],
                "bottom": surface_levels[_name] - _l["bottom"],
            }
            for _col in interpret_bro(_path, gwl)
            if _col["label"] == "Lengkeek 2022"
            for _l in _col["layers"]
        ]
        for _name, _path in profile_files.items()
    }
    return (profile_layers,)


@app.cell
def _(mo):
    # reactive mirror of the profile's selected strip
    get_selected_cpt, set_selected_cpt = mo.state("")
    return get_selected_cpt, set_selected_cpt


@app.cell(hide_code=True)
def _(
    ProfileViewer,
    profile_data,
    profile_layers,
    profile_positions,
    set_selected_cpt,
    surface_levels,
):
    # the sample CPTs line up over ~330 m, so true-scale chainage is an
    # honest axis; the toolbar toggle switches to equal spacing. Clicking a
    # strip syncs its name back via `selected`
    profile = ProfileViewer(
        profile_data,
        positions=profile_positions,
        channels=["coneResistance", "localFriction", "frictionRatio"],
        layers=profile_layers,
        overlays=[
            {"levels": surface_levels, "label": "maaiveld", "color": "#8a6642"}
        ],
        # the app column is ~710px wide: 690 keeps all four strips in
        # view without the horizontal scroll + minimap
        height=600,
        width=690,
    )

    profile.observe(
        lambda change: set_selected_cpt(change["new"]), names="selected"
    )
    profile
    return


@app.cell(column=1, hide_code=True)
def _(mo):
    mo.md("""
    ### Edited layers, live in Python

    The layer column on the right of the chart is editable: drag a
    boundary, split or merge layers, pick a soil class. Every edit lands
    in this DataFrame through the `editedLayers` trait.
    """)
    return


@app.cell
def _(get_edited_layers, pd):
    # boundary drags come back in pixel-space precision: round for display
    pd.DataFrame(get_edited_layers()).round(2)
    return


@app.cell(hide_code=True)
def _(mo):
    # spacer that drops the selection panel beside the profile in the
    # other column
    mo.Html("<div style='height: 490px'></div>")
    return


@app.cell(hide_code=True)
def _(get_selected_cpt, mo, profile_data):
    _name = get_selected_cpt()
    _n = int((profile_data["name"] == _name).sum()) if _name else 0
    mo.md(f"""
    ### Strip selection, live in Python

    Clicking a strip in the profile syncs its name back through the
    `selected` trait.

    Selected strip: **{_name or "none"}**{f" ({_n} samples)" if _name else ""}
    """)
    return


if __name__ == "__main__":
    app.run()
