# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "cpt-anywidget",
#     "marimo>=0.24",
#     "python-ags4>=1.1",
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
    # AGS4 CPTs with python-ags4

    [python-ags4](https://gitlab.com/ags-data-format-wg/ags-python-library)
    parses the AGS4 exchange format into pandas DataFrames, one per group.
    CPT data lives in the `SCPG` group (one row per test) and the `SCPT`
    group (one row per depth sample).

    Two example files:

    - `CPT_90524_AGS01.ags`: an onshore CPT from the New Zealand Geotechnical
      Database (Wellington, via
      [ucgmsim/Ancillary-tools](https://github.com/ucgmsim/Ancillary-tools)),
      one continuous push to 20 m.
    - `N6016_BH_WFS1-2A_AGS4_150909.ags`: a downhole CPT borehole from the
      Borssele Wind Farm Zone site investigation (public RVO data, via the
      [groundhog](https://github.com/snakesonabrain/groundhog) test suite),
      18 short cone runs pushed from the advancing borehole bottom, with
      gaps between runs.
    """)
    return


@app.cell
def _():
    import marimo as mo
    import os
    import pandas as pd
    from python_ags4 import AGS4

    # hot-reload index.js in place when it changes (needs anywidget[dev])
    os.environ["ANYWIDGET_HMR"] = "1"

    from cpt_anywidget import Channel, CPTViewer

    return AGS4, CPTViewer, Channel, mo, pd


@app.cell(hide_code=True)
def _(mo):
    ags_files = sorted(
        (mo.notebook_dir().parent / "examples" / "ags").glob("*.ags")
    )
    file_select = mo.ui.dropdown(
        options={p.name: p for p in ags_files},
        value=ags_files[0].name,
        label="AGS file",
    )
    file_select
    return (file_select,)


@app.cell(hide_code=True)
def _(AGS4, file_select, mo):
    tables, _headings = AGS4.AGS4_to_dataframe(file_select.value)

    _proj = tables["PROJ"].query("HEADING == 'DATA'").iloc[0]
    _loca = tables["LOCA"].query("HEADING == 'DATA'").iloc[0]

    def _field(row, key):
        _v = row.get(key, "")
        return _v if str(_v).strip() else "unknown"

    mo.md(
        f"""
    **{_field(_loca, "LOCA_ID")}**, {_field(_proj, "PROJ_NAME")}

    | | |
    |---|---|
    | Client | {_field(_proj, "PROJ_CLNT")} |
    | Contractor | {_field(_proj, "PROJ_CONT")} |
    | Final depth | {_field(_loca, "LOCA_FDEP")} m |
    | Easting, northing | {_field(_loca, "LOCA_NATE")}, {_field(_loca, "LOCA_NATN")} |
    | Started | {_field(_loca, "LOCA_STAR")} |
    """
    )
    return (tables,)


@app.cell(hide_code=True)
def _(mo, tables):
    mo.vstack(
        [
            mo.md("The `SCPG` group: one row of metadata per cone run."),
            tables["SCPG"],
        ]
    )
    return


@app.cell(hide_code=True)
def _(AGS4, tables):
    # convert_to_numeric drops the UNIT/TYPE header rows and casts the
    # data columns. Renaming to the BRO channel names buys the widget's
    # built-in display defaults; the AGS-specific derived channels
    # (qt, qnet, Bq) keep their own names and get explicit bindings.
    _units = tables["SCPT"].query("HEADING == 'UNIT'").iloc[0]
    _scpt = AGS4.convert_to_numeric(tables["SCPT"])
    # files differ in delivered units: the UNIT row says which columns
    # arrive in kN/m2, convert those to MPa to match the display defaults
    for _col, _unit in _units.items():
        if str(_unit).strip() == "kN/m2" and _col in _scpt.columns:
            _scpt[_col] /= 1000
    _scpt = _scpt.rename(
        columns={
            "SCPT_DPTH": "depth",
            "SCPT_RES": "coneResistance",
            "SCPT_FRES": "localFriction",
            "SCPT_PWP1": "porePressureU1",
            "SCPT_PWP2": "porePressureU2",
            "SCPT_FRR": "frictionRatio",
            "SCPT_QT": "qt",
            "SCPT_QNET": "qnet",
            "SCPT_BQ": "Bq",
        }
    )
    # some files deliver no friction ratio: derive the standard fs/qc
    # ratio, masked where either sensor reads at or below zero (the NZGD
    # file has scattered zero-shift spikes with negative fs)
    if "frictionRatio" not in _scpt.columns or _scpt["frictionRatio"].isna().all():
        _scpt["frictionRatio"] = (
            100 * _scpt["localFriction"] / _scpt["coneResistance"]
        ).where(
            (_scpt["coneResistance"] > 0) & (_scpt["localFriction"] >= 0)
        )
    cpt_all = _scpt[
        ["SCPG_TESN"]
        + [
            c
            for c in (
                "depth",
                "coneResistance",
                "localFriction",
                "frictionRatio",
                "porePressureU1",
                "porePressureU2",
                "qt",
                "qnet",
                "Bq",
            )
            if c in _scpt.columns and _scpt[c].notna().any()
        ]
    ]
    return (cpt_all,)


@app.cell(hide_code=True)
def _(cpt_all, mo):
    _runs = sorted(r for r in cpt_all["SCPG_TESN"].unique() if str(r).strip())
    run_select = mo.ui.dropdown(
        options={"all runs": None} | {r: r for r in _runs},
        value="all runs",
        label="cone run",
    )
    # a single continuous push has nothing to pick
    run_select if _runs else None
    return (run_select,)


@app.cell(hide_code=True)
def _(cpt_all, pd, run_select):
    if run_select.value is None:
        # stitch the runs into one profile. An all-None separator row in
        # each gap keeps the plotted line from bridging untested depth.
        _parts = []
        _prev_max = None
        for _, _run in cpt_all.sort_values("depth").groupby("SCPG_TESN"):
            if _prev_max is not None:
                _sep = dict.fromkeys(cpt_all.columns)
                _sep["depth"] = (_prev_max + _run["depth"].min()) / 2
                _parts.append(pd.DataFrame([_sep]))
            _parts.append(_run)
            _prev_max = _run["depth"].max()
        _df = pd.concat(_parts, ignore_index=True)
    else:
        _df = cpt_all[cpt_all["SCPG_TESN"] == run_select.value]
    cpt_data = _df.drop(columns="SCPG_TESN")
    return (cpt_data,)


@app.cell(hide_code=True)
def _(cpt_data, mo):
    _options = [k for k in cpt_data.columns if k != "depth"]
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
def _(CPTViewer, Channel, channel_select, cpt_data):
    _bindings = {
        "qt": Channel("qt", label="qt", unit="MPa"),
        "qnet": Channel("qnet", label="qnet", unit="MPa"),
        "Bq": Channel("Bq", label="Bq", side="top"),
    }
    CPTViewer(
        cpt_data,
        channels=[_bindings.get(k, k) for k in channel_select.value],
        # pin Rf to the conventional 0 to 10 % axis: near-surface spikes
        # in the derived ratio would stretch a data-driven axis
        limits={"frictionRatio": (0, 10)},
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


if __name__ == "__main__":
    app.run()
