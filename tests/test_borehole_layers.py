import pathlib

import pytest

pygef = pytest.importorskip("pygef")

from cpt_anywidget import layers_from_bore

BORE_GEF = (
    pathlib.Path(__file__).parent.parent
    / "examples"
    / "gef-bore"
    / "example_bore.gef"
)


@pytest.fixture(scope="module")
def bore():
    return pygef.read_bore(BORE_GEF)


def test_depth_layers_match_boundaries(bore):
    layers = layers_from_bore(bore)
    rows = bore.data
    assert len(layers) == rows.height
    assert [l["top"] for l in layers] == rows["upperBoundary"].to_list()
    assert [l["bottom"] for l in layers] == rows["lowerBoundary"].to_list()


def test_shallowest_layer_first(bore):
    tops = [l["top"] for l in layers_from_bore(bore)]
    assert tops == sorted(tops)


def test_nap_uses_delivered_offset(bore):
    layers = layers_from_bore(bore, vertical_key="nap")
    offset = bore.delivered_vertical_position_offset
    expected = [offset - d for d in bore.data["upperBoundary"].to_list()]
    assert [l["top"] for l in layers] == expected


def test_known_soil_name_gets_lithology_bands(bore):
    layers = layers_from_bore(bore)
    zand = next(l for l in layers if l["label"] == "zand")
    # base lithology: one band spanning the full width, styled from the
    # BRO lithology table (not the gray unknown-name fallback)
    (band,) = zand["bands"]
    assert (band["x1"], band["x2"]) == (0.0, 1.0)
    assert band["color"] != "#b0b0b0"
    assert band["hatch"] == "."


def test_remarks_become_descriptions(bore):
    layers = layers_from_bore(bore)
    expected = [(r or "").strip() for r in bore.data["remarks"].to_list()]
    assert [l.get("description", "") for l in layers] == expected
    # stripped, so no layer carries a whitespace-only description
    assert all(l["description"] for l in layers if "description" in l)


def test_unknown_soil_name_gets_fallback_band(bore):
    layers = layers_from_bore(bore)
    unknown = next(l for l in layers if l["label"] == "niet gedefinieerd")
    assert unknown["bands"] == [{"x1": 0, "x2": 1, "color": "#b0b0b0"}]
