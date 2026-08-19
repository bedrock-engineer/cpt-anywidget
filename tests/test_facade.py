"""The constructor facades, tested through the seam callers cross:
Pythonic kwargs in, JSON-flat traits out."""

import pytest

from cpt_anywidget import (
    BoreholeViewer,
    Channel,
    CPTViewer,
    ProfileViewer,
    Vertical,
)

DATA = {"depth": [1.0, 0.0], "coneResistance": [2.0, 1.0]}

LONG = {
    "name": ["a", "a", "b"],
    "nap": [1.0, 2.0, 0.5],
    "coneResistance": [1.0, 2.0, 3.0],
}


def test_data_tidies_into_cpt_data():
    v = CPTViewer(DATA)
    assert v.cptData == {"depth": [0.0, 1.0], "coneResistance": [1.0, 2.0]}


def test_channel_mix_normalizes_to_specs():
    v = CPTViewer(
        channels=["coneResistance", Channel("qc2", color="red"), {"key": "u1"}]
    )
    assert v.channels == [
        "coneResistance",
        {"key": "qc2", "color": "red"},
        {"key": "u1"},
    ]


def test_vertical_binding_normalizes_to_spec():
    v = CPTViewer(vertical=Vertical("taw", label="TAW [m]", up=True))
    assert v.verticalKey == {"key": "taw", "label": "TAW [m]", "up": True}


def test_vertical_string_passes_through():
    v = CPTViewer(vertical="nap")
    assert v.verticalKey == "nap"


def test_vertical_limits_orient_to_render_direction_either_way_round():
    a = CPTViewer(vertical="nap", limits={"nap": (-10.0, 5.0)})
    b = CPTViewer(vertical="nap", limits={"nap": (5.0, -10.0)})
    assert a.axisLimits == b.axisLimits == {"nap": [5.0, -10.0]}


def test_depth_limits_sort_ascending_and_channel_limits_pass_as_given():
    v = CPTViewer(limits={"depth": (10.0, 0.0), "coneResistance": (30.0, 0.0)})
    assert v.axisLimits == {
        "depth": [0.0, 10.0],
        "coneResistance": [30.0, 0.0],
    }


def test_raw_vertical_key_kwarg_drives_orientation_and_sort():
    v = CPTViewer(
        {"nap": [1.0, 2.0], "qc": [1.0, 2.0]},
        verticalKey="nap",
        limits={"nap": (-10.0, 5.0)},
    )
    assert v.cptData["nap"] == [2.0, 1.0]
    assert v.axisLimits == {"nap": [5.0, -10.0]}


def test_raw_traits_pass_through_untouched():
    v = CPTViewer(annotations=[{"at": 1.0, "label": "gw"}], width=500)
    assert v.annotations == [{"at": 1.0, "label": "gw"}]
    assert v.width == 500


def test_profile_strips_sort_by_chainage_and_tidy_per_group():
    v = ProfileViewer(LONG, positions={"a": 100.0, "b": 0.0})
    assert [c["name"] for c in v.cpts] == ["b", "a"]
    # nap is the profile default: highest sample first within each strip
    assert v.cpts[1]["data"]["nap"] == [2.0, 1.0]


def test_profile_positions_default_to_input_order():
    v = ProfileViewer(LONG)
    assert [(c["name"], c["distance"]) for c in v.cpts] == [
        ("a", 0.0),
        ("b", 1.0),
    ]


def test_profile_missing_positions_raise():
    with pytest.raises(ValueError, match=r"positions missing for \['b'\]"):
        ProfileViewer(LONG, positions={"a": 0.0})


def test_profile_layers_for_unknown_names_raise():
    with pytest.raises(ValueError, match=r"layers for unknown CPTs \['x'\]"):
        ProfileViewer(LONG, layers={"x": []})


def test_profile_layers_attach_to_their_strip_only():
    v = ProfileViewer(LONG, layers={"a": [{"top": 2.0, "bottom": 1.0}]})
    by_name = {c["name"]: c for c in v.cpts}
    assert by_name["a"]["layers"] == [{"top": 2.0, "bottom": 1.0}]
    assert "layers" not in by_name["b"]


def test_profile_nap_default_orients_limits():
    v = ProfileViewer(limits={"nap": (-10.0, 5.0)})
    assert v.axisLimits == {"nap": [5.0, -10.0]}


def test_profile_channel_mix_normalizes_like_cpt_viewer():
    v = ProfileViewer(channels=[Channel("qc", unit="MPa"), "u1"])
    assert v.channels == [{"key": "qc", "unit": "MPa"}, "u1"]


LAYERS = [{"top": 1.0, "bottom": 0.0, "label": "sand", "bands": []}]


def test_borehole_layers_pass_through_and_limits_orient():
    v = BoreholeViewer(LAYERS, vertical="nap", limits={"nap": (-10.0, 5.0)})
    assert v.layers == LAYERS
    assert v.verticalKey == "nap"
    assert v.axisLimits == {"nap": [5.0, -10.0]}


def test_borehole_vertical_binding_normalizes_to_spec():
    v = BoreholeViewer(vertical=Vertical("taw", up=True))
    assert v.verticalKey == {"key": "taw", "up": True}


def test_borehole_raw_vertical_key_kwarg_orients_limits():
    v = BoreholeViewer(verticalKey="nap", limits={"nap": (-10.0, 5.0)})
    assert v.axisLimits == {"nap": [5.0, -10.0]}
