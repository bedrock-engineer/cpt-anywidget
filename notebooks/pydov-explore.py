# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "cpt-anywidget",
#     "geopandas>=1",
#     "lonboard>=0.16",
#     "marimo>=0.24",
#     "pandas>=2",
#     "pyarrow>=16",
#     "pydov>=4.0",
# ]
#
# [tool.uv.sources]
# cpt-anywidget = { path = "..", editable = true }
# ///

import marimo

__generated_with = "0.24.0"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # cpt-anywidget with pydov (Flanders, DOV)

    [pydov](https://pydov.readthedocs.io) queries the Flemish soil and
    subsoil database (DOV, Databank Ondergrond Vlaanderen) directly over
    its public web services: no files on disk, every result a pandas
    DataFrame. This notebook loads a small area south of Ghent, a 2016
    site investigation line with electrical CPTs and geotechnically
    coded borings a few tens of meters apart.

    Two things differ from the Dutch BRO data the other notebooks use:

    - **units are mixed**: qc comes in MPa but fs and u in kPa, and DOV
      delivers no friction ratio, so the loader converts and computes
    - **the datum is TAW** (Tweede Algemene Waterpassing), not NAP: a
      `Vertical` binding gives the widgets a TAW axis, the package never
      needs to know the datum
    """)
    return


@app.cell
def _():
    import marimo as mo
    import os
    import geopandas as gpd
    import pandas as pd
    import shapely

    # hot-reload index.js in place when it changes (needs anywidget[dev])
    os.environ["ANYWIDGET_HMR"] = "1"

    from lonboard import Map, PathLayer, ScatterplotLayer
    from owslib.fes2 import PropertyIsEqualTo, PropertyIsLike
    from pydov.search.boring import BoringSearch
    from pydov.search.interpretaties import GeotechnischeCoderingSearch
    from pydov.search.sondering import SonderingSearch
    from pydov.util.location import Box, Within
    from pydov.util.query import Join

    from cpt_anywidget import (
        BoreholeViewer,
        CPTViewer,
        ProfileViewer,
        Vertical,
        chainage,
        to_vertical,
    )

    return (
        BoreholeViewer,
        BoringSearch,
        Box,
        CPTViewer,
        GeotechnischeCoderingSearch,
        Join,
        Map,
        PathLayer,
        ProfileViewer,
        PropertyIsEqualTo,
        PropertyIsLike,
        ScatterplotLayer,
        SonderingSearch,
        Vertical,
        Within,
        chainage,
        gpd,
        mo,
        pd,
        shapely,
        to_vertical,
    )


@app.cell
def _(
    BoringSearch,
    Box,
    GeotechnischeCoderingSearch,
    SonderingSearch,
    Vertical,
):
    # the search area: a 500 x 200 m box south of Ghent (Belgian Lambert
    # 72, EPSG:31370) covering the GEO-15/035 investigation line
    AREA = Box(105200, 195400, 105700, 195600, epsg=31370)

    # the TAW datum as a vertical-axis binding; "taw" is the data column
    TAW = Vertical("taw", label="TAW [m]", up=True, format="+.2f")

    sond_search = SonderingSearch()
    boring_search = BoringSearch()
    geo_search = GeotechnischeCoderingSearch()
    return AREA, TAW, boring_search, geo_search, sond_search


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## CPTs (sonderingen)

    Listing first, measurements later: `return_fields` limited to WFS
    attributes lists the CPTs in the box without downloading any
    measurement XML. The area also holds mechanical soundings from the
    1960s (qc only, no corrected depth), so the query keeps the
    electrical ones.
    """)
    return


@app.cell
def _(AREA, PropertyIsEqualTo, Within, sond_search):
    cpt_meta = sond_search.search(
        location=Within(AREA),
        query=PropertyIsEqualTo(
            propertyname="sondeermethode", literal="continu elektrisch"
        ),
        return_fields=(
            "pkey_sondering",
            "sondeernummer",
            "x",
            "y",
            "start_sondering_mtaw",
            "diepte_sondering_tot",
            "datum_aanvang",
        ),
    ).sort_values("x", ignore_index=True)
    cpt_meta
    return (cpt_meta,)


@app.cell(hide_code=True)
def _(cpt_meta, mo):
    cpt_select = mo.ui.dropdown(
        options=dict(zip(cpt_meta.sondeernummer, cpt_meta.pkey_sondering)),
        value="GEO-15/035-S121",
        label="CPT",
    )
    cpt_select
    return (cpt_select,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ### The area on the map

    [lonboard](https://developmentseed.org/lonboard/latest/) puts the
    query results on a map: blue dots are the electrical CPTs, brown
    dots the geotechnically coded borings from further below, the gray
    line is the profile the last section follows, and the orange dot
    tracks the CPT picked above. Hover a dot for its number. The
    Lambert 72 coordinates reproject to WGS84 through geopandas.
    """)
    return


@app.cell(hide_code=True)
def _(
    Map,
    PathLayer,
    ScatterplotLayer,
    borings,
    cpt_meta,
    cpt_select,
    gpd,
    profile_positions,
    shapely,
):
    def _wgs84(df, columns):
        return gpd.GeoDataFrame(
            columns,
            geometry=gpd.points_from_xy(df.x, df.y),
            crs="EPSG:31370",
        ).to_crs("EPSG:4326")

    _cpts = _wgs84(
        cpt_meta,
        {
            "sondeernummer": cpt_meta.sondeernummer,
            "diepte tot [m]": cpt_meta.diepte_sondering_tot,
            "datum": cpt_meta.datum_aanvang.astype(str),
        },
    )
    _borings = _wgs84(borings, {"boornummer": borings.boornummer})

    # the profile line, west to east through the S1xx strips
    _line = cpt_meta.set_index("sondeernummer").loc[list(profile_positions)]
    _path = gpd.GeoDataFrame(
        {"name": ["profiellijn"]},
        geometry=[shapely.LineString(zip(_line.x, _line.y))],
        crs="EPSG:31370",
    ).to_crs("EPSG:4326")

    Map(
        layers=[
            PathLayer.from_geopandas(
                _path, get_color=[150, 150, 150], width_min_pixels=2
            ),
            ScatterplotLayer.from_geopandas(
                _cpts,
                get_fill_color=[66, 105, 208],
                radius_min_pixels=4,
                pickable=True,
            ),
            ScatterplotLayer.from_geopandas(
                _borings,
                get_fill_color=[138, 102, 66],
                radius_min_pixels=6,
                stroked=True,
                get_line_color=[255, 255, 255],
                line_width_min_pixels=1,
                pickable=True,
            ),
            ScatterplotLayer.from_geopandas(
                _cpts[(cpt_meta.pkey_sondering == cpt_select.value).values],
                get_fill_color=[216, 140, 60],
                radius_min_pixels=8,
                stroked=True,
                get_line_color=[60, 60, 60],
                line_width_min_pixels=1,
            ),
        ],
        show_tooltip=True,
        height=420,
    )
    return


@app.cell
def _(PropertyIsEqualTo, cpt_select, sond_search):
    # the same search keyed on one pkey downloads the measurement XML:
    # one row per depth sample, metadata columns repeated on every row
    sounding = sond_search.search(
        query=PropertyIsEqualTo(
            propertyname="pkey_sondering", literal=cpt_select.value
        )
    )
    sounding
    return (sounding,)


@app.cell(hide_code=True)
def _(mo, sounding):
    _row = sounding.iloc[0]
    mo.md(
        f"""
    **{_row.sondeernummer}**

    | | |
    |---|---|
    | Surface level | {_row.start_sondering_mtaw} m TAW |
    | Final depth | {_row.diepte_sondering_tot} m |
    | Date | {_row.datum_aanvang} |
    | Method | {_row.sondeermethode} |
    | Contractor | {_row.uitvoerder} |
    """
    )
    return


@app.cell(hide_code=True)
def _(pd, sounding):
    # tidy columns for the widget. DOV mixes units (qc in MPa, fs in kPa)
    # and delivers no friction ratio, so fs converts to MPa and Rf is
    # computed. "diepte" is the inclination-corrected depth; mechanical
    # soundings lack it, then the registered tape length stands in
    cpt_surface = float(sounding["start_sondering_mtaw"].iloc[0])
    _depth = sounding["diepte"].fillna(sounding["lengte"])
    cpt_data = pd.DataFrame(
        {
            "depth": _depth,
            "taw": cpt_surface - _depth,
            "coneResistance": sounding["qc"],
            "localFriction": sounding["fs"] / 1000.0,
            "frictionRatio": sounding["fs"] / sounding["qc"] / 10.0,
            "inclination": sounding["i"],
        }
    ).dropna(axis="columns", how="all")

    # groundwater depth on the day of the test, when one was measured
    _gw = sounding["diepte_gw_m"].iloc[0]
    gw_depth = float(_gw) if pd.notna(_gw) else None
    return cpt_data, cpt_surface, gw_depth


@app.cell(hide_code=True)
def _(cpt_data, mo):
    _options = [k for k in cpt_data.columns if k not in ("depth", "taw")]
    channel_select = mo.ui.multiselect(
        options=_options,
        value=[
            k
            for k in ("coneResistance", "localFriction", "frictionRatio")
            if k in _options
        ],
        label="channels",
    )
    channel_select
    return (channel_select,)


@app.cell(hide_code=True)
def _(mo):
    vertical_select = mo.ui.radio(
        options={"depth below surface": "depth", "m TAW": "taw"},
        value="depth below surface",
        label="vertical axis",
        inline=True,
    )
    vertical_select
    return (vertical_select,)


@app.cell
def _(TAW, cpt_surface, to_vertical, vertical_select):
    vertical = TAW if vertical_select.value == "taw" else "depth"

    def at(depth_below_surface):
        """Annotation position in the selected vertical coordinate."""
        return to_vertical(depth_below_surface, cpt_surface, vertical)

    return at, vertical


@app.cell
def _(CPTViewer, at, channel_select, cpt_data, gw_depth, vertical):
    # explicit limits pin the fs and Rf axis floors at zero: a few
    # samples undershoot by sensor noise at sharp stiff-to-soft
    # transitions, and the data-driven axis would stretch to fit them.
    # The samples stay in the data; the hover readout shows them as is
    CPTViewer(
        cpt_data,
        vertical=vertical,
        channels=channel_select.value,
        limits={"localFriction": (0, 1), "frictionRatio": (0, 6)},
        annotations=(
            [
                {
                    "at": at(gw_depth),
                    "label": "grondwater",
                    "color": "#4269d0",
                    "dash": "4 2",
                }
            ]
            if gw_depth is not None
            else []
        ),
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

    The same gestures work on the borehole log and the profile below.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Geotechnically coded borings

    A "geotechnische codering" is DOV's standardized layer
    interpretation of a boring: per layer a main soil type (plus an
    optional second one) and up to three admixtures, all as codes from
    the DOV code lists. pydov exposes those code lists with their
    definitions, so labels and hover text come straight from the source.
    `Join` links the interpretations to `BoringSearch` for the boring
    numbers.
    """)
    return


@app.cell
def _(AREA, Join, Within, boring_search, geo_search):
    geo_layers_df = geo_search.search(location=Within(AREA))
    borings = (
        boring_search.search(
            query=Join(geo_layers_df, "pkey_boring"),
            return_fields=("pkey_boring", "boornummer", "x", "y"),
        )
        .drop_duplicates("pkey_boring")
        .sort_values("x", ignore_index=True)
    )
    borings
    return borings, geo_layers_df


@app.cell(hide_code=True)
def _(borings, mo):
    boring_select = mo.ui.dropdown(
        options=dict(zip(borings.boornummer, borings.pkey_boring)),
        value=borings.boornummer.iloc[0],
        label="boring",
    )
    boring_select
    return (boring_select,)


@app.cell
def _(geo_search):
    # the DOV code lists behind the coding fields, code -> definition
    # ("FZ" -> "fijn zand", "W" -> "weinig X", ...)
    _fields = geo_search.get_fields()
    grondsoort = _fields["hoofdnaam1_grondsoort"].codelist
    hoeveelheid = _fields["bijmenging1_hoeveelheid"].codelist
    return grondsoort, hoeveelheid


@app.cell
def _(grondsoort, hoeveelheid, pd, to_vertical):
    # one color per soil family; codes outside the map render gray
    _SOIL_COLORS = {
        "FZ": "#f7e77a",  # fijn zand
        "MZ": "#f4e04d",  # middelmatig zand
        "GZ": "#e6c832",  # grof zand
        "XZ": "#f4e04d",  # zand
        "ZL": "#d6c45a",  # zandleem
        "LE": "#b5a642",  # leem
        "SI": "#b5a642",  # silt
        "KL": "#78a86c",  # klei
        "VE": "#8a6642",  # veen
        "FG": "#d88c3c",  # fijn grind
        "MG": "#d88c3c",  # middelmatig grind
        "GG": "#d88c3c",  # grof grind
        "XG": "#d88c3c",  # grind
        "SN": "#9a9a9a",  # steenfragmenten
        "XX": "#b0b0b0",  # onbekend
    }
    _FALLBACK = "#b0b0b0"

    def _band(code, x1, x2):
        return {"x1": x1, "x2": x2, "color": _SOIL_COLORS.get(code, _FALLBACK)}

    def _admixtures(row):
        """Hover text from the bijmenging codes, e.g. "weinig leem,
        plaatselijk glauconiethoudend". The hoeveelheid definitions
        carry an X placeholder for the soil name."""
        parts = []
        for n in (1, 2, 3):
            code = row[f"bijmenging{n}_grondsoort"]
        
            if pd.isna(code):
                continue
            
            soil = grondsoort[code].definition
            amount = row[f"bijmenging{n}_hoeveelheid"]
            text = (
                hoeveelheid[amount].definition.replace("X", soil)
                if pd.notna(amount) and amount != "N"
                else soil
            )
        
            if row[f"bijmenging{n}_plaatselijk"] is True:
                text = f"plaatselijk {text}"
            parts.append(text)
        
        return ", ".join(parts)

    def coding_layers(df, vertical):
        """One geotechnical coding as BoreholeViewer layers: bands from
        the main soil codes (an even split when there is a second one,
        DOV delivers no proportions), admixtures in the hover text.
        Layer depths convert from m below surface to the selected
        vertical coordinate via the interpretation's start level."""
        surface = float(df["start_interpretatie_mtaw"].iloc[0])
        layers = []
        for row in df.sort_values("diepte_laag_van").to_dict("records"):
            h1, h2 = row["hoofdnaam1_grondsoort"], row["hoofdnaam2_grondsoort"]
            label = grondsoort[h1].definition
            bands = [_band(h1, 0, 1)]
        
            if pd.notna(h2):
                label += f" / {grondsoort[h2].definition}"
                bands = [_band(h1, 0, 0.5), _band(h2, 0.5, 1)]
        
            layer = {
                "top": to_vertical(row["diepte_laag_van"], surface, vertical),
                "bottom": to_vertical(
                    row["diepte_laag_tot"], surface, vertical
                ),
                "label": label,
                "bands": bands,
            }
        
            description = _admixtures(row)
        
            if description:
                layer["description"] = description
            
            layers.append(layer)
        
        return layers

    return (coding_layers,)


@app.cell
def _(BoreholeViewer, boring_select, coding_layers, geo_layers_df, vertical):
    _df = geo_layers_df[geo_layers_df.pkey_boring == boring_select.value]
    BoreholeViewer(coding_layers(_df, vertical), vertical=vertical)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Length profile

    One wildcard query fetches the whole S1xx line of the 2016
    investigation: ~20 CPTs over ~470 m, west to east. Chainage comes
    from the Lambert 72 coordinates, each strip's surface level draws as
    the maaiveld overlay, and the axis is TAW: a profile compares
    elevations, depth below surface would mean something different per
    strip. The profile is wider than the notebook, so it scrolls
    sideways; the minimap above it shows where you are. Clicking a
    strip syncs its name back to Python.
    """)
    return


@app.cell
def _(AREA, PropertyIsLike, Within, chainage, pd, sond_search):
    _line = sond_search.search(
        location=Within(AREA),
        query=PropertyIsLike(
            propertyname="sondeernummer", literal="GEO-15/035-S1%"
        ),
    )
    # a few soundings on the line were aborted within 2 m and redone
    # (S112 next to S112BIS); keep the real ones
    _line = _line[_line.diepte_sondering_tot >= 5]

    _depth = _line.diepte.fillna(_line.lengte)
    profile_data = pd.DataFrame(
        {
            "name": _line.sondeernummer,
            "taw": _line.start_sondering_mtaw - _depth,
            "coneResistance": _line.qc,
            "localFriction": _line.fs / 1000.0,
            "frictionRatio": _line.fs / _line.qc / 10.0,
        }
    )

    # chainage walks the coordinates in the order given: sort the line
    # west to east first
    _meta = _line.drop_duplicates("pkey_sondering").sort_values("x")
    profile_positions = chainage(
        {r.sondeernummer: (r.x, r.y) for r in _meta.itertuples()}
    )
    surface_levels = {
        r.sondeernummer: float(r.start_sondering_mtaw)
        for r in _meta.itertuples()
    }
    return profile_data, profile_positions, surface_levels


@app.cell
def _(
    ProfileViewer,
    TAW,
    profile_data,
    profile_positions,
    set_selected_cpt,
    surface_levels,
):
    profile = ProfileViewer(
        profile_data,
        positions=profile_positions,
        vertical=TAW,
        channels=["coneResistance", "localFriction", "frictionRatio"],
        limits={"localFriction": (0, 1), "frictionRatio": (0, 6)},
        overlays=[
            {"levels": surface_levels, "label": "maaiveld", "color": "#8a6642"}
        ],
        width=1000,
        height=550,
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
    Selected strip: **{get_selected_cpt() or "none"}**. Click a strip to
    (de)select it.
    """)
    return


if __name__ == "__main__":
    app.run()
