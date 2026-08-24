import pytest

from cpt_anywidget.lithology import BRO_LITHOLOGY


def test_bands_are_proportional():
    for name, spec in BRO_LITHOLOGY.items():
        assert sum(sub["width"] for sub in spec) <= 1 + 1e-9, name
        assert all(sub["color"].startswith("#") for sub in spec), name


def test_matches_brodata_table():
    # the table is vendored from brodata; this guards against drift when
    # the dev environment picks up a newer brodata
    plot = pytest.importorskip("brodata.plot")

    def hexc(color):
        r, g, b = (round(c * 255) for c in color)
        return f"#{r:02x}{g:02x}{b:02x}"

    theirs = {}
    for name, spec in plot.get_bro_lithology_properties().items():
        if isinstance(spec, dict):
            spec = [{"width": 1, **spec}]
        theirs[name] = [
            {"width": sub["width"], "color": hexc(sub["color"])}
            | ({"hatch": sub["hatch"]} if "hatch" in sub else {})
            for sub in spec
        ]
    assert BRO_LITHOLOGY == theirs
