import marimo

__generated_with = "0.23.13"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import os
    import pandas as pd

    # hot-reload index.js in place when it changes (needs anywidget[dev])
    os.environ["ANYWIDGET_HMR"] = "1"

    from cpt_anywidget import (
        BHRGTViewer,
        CPTViewer,
        ProfileViewer,
        chainage,
        from_vertical,
        layers_from_bhrgt,
        to_vertical,
    )
    from brodata.cpt import ConePenetrationTest
    from brodata.bhr import GeotechnicalBoreholeResearch

    return (
        BHRGTViewer,
        CPTViewer,
        ConePenetrationTest,
        GeotechnicalBoreholeResearch,
        ProfileViewer,
        chainage,
        from_vertical,
        layers_from_bhrgt,
        mo,
        pd,
        to_vertical,
    )


@app.cell(hide_code=True)
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
def _(interp_dummy, mo):
    # seed the editable column from one of the interpretations; starts empty
    seed_select = mo.ui.radio(
        options=[col["label"] for col in interp_dummy],
        label="seed edit column from",
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
    edited_store,
    from_vertical,
    gwl,
    hydrostatic,
    interp_dummy,
    interpretations,
    seed_select,
    set_edited_layers,
    vertical_select,
):
    if edited_store["seed"] != seed_select.value:
        # (re)seed: copy the chosen interpretation's layers, class-keyed —
        # color and label derive from the widget's soil_classes palette (the
        # dummy labels double as class names); no selection clears the column
        _col = next(
            (c for c in interp_dummy if c["label"] == seed_select.value), None
        )
        edited_store["seed"] = seed_select.value
        edited_store["layers"] = (
            []
            if _col is None
            else [
                {"top": l["top"], "bottom": l["bottom"], "class": l["label"]}
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
def _(at, cpt):
    # groundwater level (m below surface), shared by the GWL annotation
    # and the hydrostatic overlay
    gwl = 2.5

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
    return gwl, hydrostatic


@app.cell
def _(at, interp_dummy):
    # layer boundaries converted to the selected vertical coordinate
    interpretations = [
        {
            "label": col["label"],
            "layers": [
                {**layer, "top": at(layer["top"]), "bottom": at(layer["bottom"])}
                for layer in col["layers"]
            ],
        }
        for col in interp_dummy
    ]
    return (interpretations,)


@app.cell(hide_code=True)
def _(cpt, cpt_data):
    # dummy soil interpretations, boundaries in m below surface
    _final = max(d for d in cpt_data["depth"] if d is not None)

    interp_dummy = [
        {
            "label": "Robertson",
            "layers": [
                {"top": cpt.predrilledDepth, "bottom": 2.4, "label": "sand", "color": "#f4e04d"},
                {"top": 2.4, "bottom": 6.8, "label": "clay", "color": "#78a86c"},
                {"top": 6.8, "bottom": 9.5, "label": "peat", "color": "#8a6642"},
                {"top": 9.5, "bottom": _final, "label": "sand", "color": "#f4e04d"},
            ],
        },
        {
            "label": "CPT-Core-A",
            "layers": [
                {"top":cpt.predrilledDepth, "bottom": 2.1, "label": "sand", "color": "#f4e04d"},
                {"top": 2.1, "bottom": 6.2, "label": "clay", "color": "#78a86c"},
                {"top": 6.2, "bottom": 10.3, "label": "peat", "color": "#8a6642"},
                {"top": 10.3, "bottom": _final, "label": "sand", "color": "#f4e04d"},
            ],
        },
    ]
    return (interp_dummy,)


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
    """)
    return


@app.cell(hide_code=True)
def _(ConePenetrationTest, chainage, mo, pd):
    # every sample CPT in one tidy long frame — name + nap + qc per row,
    # the ProfileViewer facade groups rows by the name column — plus
    # chainage positions from the delivered RD coordinates and each CPT's
    # surface level for the maaiveld overlay
    _cpts = [
        ConePenetrationTest(str(p))
        for p in sorted(
            (mo.notebook_dir().parent / "examples" / "broxml-cpt").glob("*.xml")
        )
    ]
    _frames = []
    for _c in _cpts:
        _df = _c.conePenetrationTest.apply(pd.to_numeric, errors="coerce")
        _frames.append(
            pd.DataFrame(
                {
                    "name": _c.broId,
                    "nap": float(_c.offset) - _df["depth"],
                    "coneResistance": _df["coneResistance"],
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
    return profile_data, profile_positions, surface_levels


@app.cell
def _(
    ProfileViewer,
    profile_data,
    profile_positions,
    set_selected_cpt,
    surface_levels,
):
    # the two sample CPTs sit ~26 km apart, so true-scale chainage is an
    # honest but extreme axis — the toolbar toggle switches to equal
    # spacing. Clicking a strip syncs its name back via `selected`
    profile = ProfileViewer(
        profile_data,
        positions=profile_positions,
        channel="coneResistance",
        overlays=[
            {"levels": surface_levels, "label": "maaiveld", "color": "#8a6642"}
        ],
        height=420,
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
    Selected strip: **{get_selected_cpt() or '—'}** — "
        "click a strip to (de)select it.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Geotechnical borehole (BHR-GT)
    """)
    return


@app.cell
def _(BHRGTViewer, gt_borehole, layers_from_bhrgt):
    # the standalone borehole viewer: soil-composition bands per layer,
    # same zoom/hover contract as the CPT chart
    BHRGTViewer(layers=layers_from_bhrgt(gt_borehole, "depth"))
    return


if __name__ == "__main__":
    app.run()
