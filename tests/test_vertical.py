"""The vertical-coordinate helpers: what a vertical *is* and the datum
arithmetic every value crosses on its way to the widgets."""

import pytest

from cpt_anywidget import Vertical, from_vertical, to_vertical
from cpt_anywidget.vertical import resolve_vertical


def test_resolve_depth_carries_builtin_defaults():
    v = resolve_vertical("depth")
    assert v == Vertical("depth", "depth [m]", up=False, format=".2f")


def test_resolve_nap_is_positive_up_and_signed():
    v = resolve_vertical("nap")
    assert v == Vertical("nap", "NAP [m]", up=True, format="+.2f")


def test_resolve_unknown_key_reads_as_depth_like():
    v = resolve_vertical("taw")
    assert v == Vertical("taw", "taw", up=False, format=".2f")


def test_resolve_explicit_fields_win_over_key_defaults():
    v = resolve_vertical(Vertical("nap", label="elevation", up=False))
    assert v == Vertical("nap", "elevation", up=False, format="+.2f")


def test_resolve_accepts_spec_dicts():
    v = resolve_vertical({"key": "taw", "up": True})
    assert v == Vertical("taw", "taw", up=True, format=".2f")


def test_spec_drops_unset_fields_and_collapses_to_bare_key():
    assert Vertical("nap").spec() == "nap"
    assert Vertical("taw", up=True).spec() == {"key": "taw", "up": True}


def test_to_vertical_depth_like_returns_depth_unchanged():
    assert to_vertical(3.5, 12.0, "depth") == 3.5
    assert to_vertical(3.5, 12.0, "taw") == 3.5


def test_to_vertical_positive_up_subtracts_from_offset():
    assert to_vertical(3.5, 12.0, "nap") == 8.5
    assert to_vertical(3.5, 12.0, Vertical("taw", up=True)) == 8.5


def test_to_vertical_passes_none_and_coerces_numeric_strings():
    # brodata sometimes yields numeric strings for depth and offset
    assert to_vertical(None, 12.0, "nap") is None
    assert to_vertical("3.5", "12.0", "nap") == 8.5


def test_from_vertical_inverts_to_vertical():
    assert from_vertical(to_vertical(3.5, 12.0, "nap"), 12.0, "nap") == 3.5
    assert from_vertical(3.5, 12.0, "depth") == 3.5


def test_to_vertical_non_numeric_raises():
    with pytest.raises(ValueError):
        to_vertical("veen", 12.0, "nap")
