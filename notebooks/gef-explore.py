# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "cpt-anywidget",
#     "marimo>=0.23.16",
#     "polars>=1.43",
#     "pygef>=0.14",
# ]
#
# [tool.uv.sources]
# cpt-anywidget = { path = "..", editable = true }
# ///

import marimo

__generated_with = "0.23.16"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # GEF CPTs with pygef

    [pygef](https://cemsbv.github.io/pygef/) parses the GEF exchange
    format into a polars DataFrame with BRO column names. `CPTViewer`
    ships display defaults for those names, so the frame goes into the
    widget almost as-is.
    """)
    return


@app.cell
def _():
    import marimo as mo
    import os
    import polars as pl
    import pygef

    # hot-reload index.js in place when it changes (needs anywidget[dev])
    os.environ["ANYWIDGET_HMR"] = "1"

    from cpt_anywidget import BoreholeViewer, CPTViewer, layers_from_bore, to_vertical

    return (
        BoreholeViewer,
        CPTViewer,
        layers_from_bore,
        mo,
        pl,
        pygef,
        to_vertical,
    )


@app.cell(hide_code=True)
def _(mo):
    gef_files = sorted(
        (mo.notebook_dir().parent / "examples" / "gef-cpt").glob("*.gef")
    )
    file_select = mo.ui.dropdown(
        options={p.name: p for p in gef_files},
        value=gef_files[0].name,
        label="GEF file",
    )
    file_select
    return (file_select,)


@app.cell(hide_code=True)
def _(file_select, mo, pygef):
    cpt = pygef.read_cpt(file_select.value)
    mo.md(
        f"""
    **{cpt.alias or cpt.bro_id}**

    | | |
    |---|---|
    | Final depth | {cpt.final_depth} m |
    | Offset ({cpt.delivered_vertical_position_datum.value}) | {cpt.delivered_vertical_position_offset} m |
    | Quality class | {cpt.quality_class} |
    | Location | {cpt.delivered_location.x}, {cpt.delivered_location.y} |
    | Date | {cpt.research_report_date} |
    | Predrilled depth | {cpt.predrilled_depth} m |
    """
    )
    return (cpt,)


@app.cell
def _(cpt):
    cpt.data
    return


@app.cell(hide_code=True)
def _(cpt, pl):
    # tidy columns straight from pygef: BRO names throughout, so only two
    # renames. depthOffset is the NAP elevation pygef already computed,
    # inclinationResultant gets the widget's default binding as inclination.
    # GEF files vary in what they deliver: without inclination pygef emits
    # no corrected depth (penetration length is the depth then), and
    # without a measured friction ratio its computed one stands in
    _df = cpt.data
    if "depth" not in _df.columns:
        _df = _df.with_columns(pl.col("penetrationLength").alias("depth"))
    if "frictionRatio" not in _df.columns:
        _df = _df.rename({"frictionRatioComputed": "frictionRatio"})
    _df = _df.rename(
        {"depthOffset": "nap", "inclinationResultant": "inclination"},
        strict=False,
    )
    cpt_data = _df.select(
        c
        for c in (
            "depth",
            "nap",
            "coneResistance",
            "localFriction",
            "frictionRatio",
            "porePressureU1",
            "porePressureU2",
            "inclination",
        )
        if c in _df.columns
    )
    return (cpt_data,)


@app.cell(hide_code=True)
def _(cpt_data, mo):
    _options = [k for k in cpt_data.columns if k not in ("depth", "nap")]
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


@app.cell(hide_code=True)
def _(mo):
    vertical_select = mo.ui.radio(
        options={"depth below surface": "depth", "m NAP": "nap"},
        value="depth below surface",
        label="vertical axis",
        inline=True
    )
    vertical_select
    return (vertical_select,)


@app.cell
def _(CPTViewer, channel_select, cpt_data, vertical_select):
    CPTViewer(
        cpt_data,
        vertical=vertical_select.value,
        channels=channel_select.value,
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ### Navigating the chart

    - **zoom**: ctrl/⌘ + scroll, or a trackpad pinch; plain scrolling
      keeps scrolling the page
    - **pan**: drag inside the plot while zoomed in
    - **zoom to a range**: shift-drag a band over it
    - **reset**: double-click the chart
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## GEF borehole

    `pygef.read_bore` parses a GEF borehole log the same way. It also
    normalizes soil names to the BRO vocabulary, so `layers_from_bore` can
    style the layers with the BRO lithology colors and hatches straight
    into `BoreholeViewer`. The vertical-axis radio above flips this log too.
    """)
    return


@app.cell(hide_code=True)
def _(mo, pygef):
    bore = pygef.read_bore(
        mo.notebook_dir().parent / "examples" / "gef-bore" / "example_bore.gef"
    )
    mo.md(
        f"""
    **{bore.alias or bore.bro_id}**

    | | |
    |---|---|
    | Layers | {bore.data.height} |
    | Offset ({bore.delivered_vertical_position_datum}) | {bore.delivered_vertical_position_offset} m |
    | Location | {bore.delivered_location.x}, {bore.delivered_location.y} |
    | Date | {bore.research_report_date} |
    """
    )
    return (bore,)


@app.cell
def _(BoreholeViewer, bore, layers_from_bore, to_vertical, vertical_select):
    _layers = layers_from_bore(bore, vertical_key=vertical_select.value)

    # richer in-band labels: the soil code distinguishes admixtures the
    # plain name collapses (Zg1 vs Zs1), the sand median adds grain size
    for _layer, _row in zip(_layers, bore.data.iter_rows(named=True)):
        _code = _row.get("geotechnicalSoilCode")
        if _code and _code != "NBE":
            _layer["label"] = f"{_layer['label']} ({_code})"
        _median = _row.get("sandMedianClass")
        if _median is not None:
            _layer["label"] += f" {_median:.0f} µm"

    # a groundwater level shows as a reference line when the file has one
    _annotations = (
        [
            {
                "at": to_vertical(
                    bore.groundwater_level,
                    bore.delivered_vertical_position_offset,
                    vertical_select.value,
                ),
                "label": "GWL",
                "color": "steelblue",
                "dash": "4 2",
            }
        ]
        if bore.groundwater_level is not None
        else []
    )

    BoreholeViewer(
        layers=_layers,
        verticalKey=vertical_select.value,
        annotations=_annotations,
    )
    return


if __name__ == "__main__":
    app.run()
