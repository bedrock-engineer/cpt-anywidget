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

    from cpt_viewer import CPTViewer
    from vertical import to_vertical, from_vertical
    from bhrgt_viewer import layers_from_bhrgt
    from brodata.cpt import ConePenetrationTest
    from brodata.bhr import GeotechnicalBoreholeResearch

    return (
        CPTViewer,
        ConePenetrationTest,
        GeotechnicalBoreholeResearch,
        from_vertical,
        layers_from_bhrgt,
        mo,
        pd,
        to_vertical,
    )


@app.cell(hide_code=True)
def _(mo):
    cpt_xml_files = sorted((mo.notebook_dir() / "broxml-cpt").glob("*.xml"))
    file_select = mo.ui.dropdown(
        options={p.name: p for p in cpt_xml_files},
        value=cpt_xml_files[1].name,
        label="CPT file",
    )
    file_select
    return (file_select,)


@app.cell(hide_code=True)
def _(mo):
    bhrgt_xml_files = sorted((mo.notebook_dir() / "broxml-bhr-gt").glob("*.xml"))
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
        value=[k for k in ("coneResistance", "localFriction", "frictionRatio") if k in _options],
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


@app.cell
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
        annotations=[
            {"at": at(2.5), "label": "GWL", "color": "#4269d0", "position": "left"},
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


if __name__ == "__main__":
    app.run()
