"""The intake contract, tested through its public interface: whatever a
reader produced goes in, exactly what the widget will receive comes out."""

import math

import pytest

from cpt_anywidget import Vertical, split, tidy


def test_sorts_depth_ascending():
    out = tidy({"depth": [2.0, 0.0, 1.0], "qc": [20.0, 0.0, 10.0]})
    assert out == {"depth": [0.0, 1.0, 2.0], "qc": [0.0, 10.0, 20.0]}


def test_sorts_nap_descending():
    out = tidy({"nap": [1.0, 3.0, 2.0], "qc": [10.0, 30.0, 20.0]}, "nap")
    assert out == {"nap": [3.0, 2.0, 1.0], "qc": [30.0, 20.0, 10.0]}


def test_custom_positive_up_vertical_sorts_descending():
    out = tidy({"od": [5.0, 7.0], "qc": [1.0, 2.0]}, Vertical("od", up=True))
    assert out["od"] == [7.0, 5.0]


def test_drops_rows_without_a_vertical_value():
    out = tidy({"depth": [0.0, None, 1.0], "qc": [1.0, 99.0, 2.0]})
    assert out == {"depth": [0.0, 1.0], "qc": [1.0, 2.0]}


def test_nan_and_inf_become_none():
    out = tidy({"depth": [0.0, 1.0], "qc": [math.nan, math.inf]})
    assert out["qc"] == [None, None]


def test_ragged_columns_raise_with_lengths():
    with pytest.raises(ValueError, match=r"differ in length.*'qc': 1"):
        tidy({"depth": [0.0, 1.0], "qc": [1.0]})


def test_non_numeric_sample_names_column_and_value():
    with pytest.raises(ValueError, match=r"column 'qc'.*'1.5'.*str"):
        tidy({"depth": [0.0], "qc": ["1.5"]})


def test_missing_vertical_column_lists_the_columns():
    with pytest.raises(ValueError, match=r"'nap' not in data.*depth.*qc"):
        tidy({"depth": [0.0], "qc": [1.0]}, "nap")


def test_columns_take_any_iterable():
    np = pytest.importorskip("numpy")
    out = tidy({"depth": (0.0, 1.0), "qc": np.array([1.0, 2.0])})
    assert out == {"depth": [0.0, 1.0], "qc": [1.0, 2.0]}


def test_unrecognized_data_object_names_the_type():
    with pytest.raises(ValueError, match=r"got object.*dict of columns"):
        tidy(object())


def test_numpy_scalars_unwrap():
    np = pytest.importorskip("numpy")
    out = tidy({"depth": [np.float64(0.0)], "qc": [np.int32(3)]})
    assert out == {"depth": [0.0], "qc": [3]}
    assert type(out["qc"][0]) is int


def test_split_groups_in_first_appearance_order():
    out = split(
        {
            "name": ["b", "a", "b"],
            "depth": [0.0, 0.0, 1.0],
            "qc": [1.0, 2.0, 3.0],
        }
    )
    assert list(out) == ["b", "a"]
    assert out["b"] == {"depth": [0.0, 1.0], "qc": [1.0, 3.0]}
    assert out["a"] == {"depth": [0.0], "qc": [2.0]}


def test_split_missing_name_column_raises():
    with pytest.raises(ValueError, match=r"name column 'name' not in data"):
        split({"depth": [0.0]})


def test_split_ragged_against_name_column_raises():
    with pytest.raises(ValueError, match=r"differ in length from the name"):
        split({"name": ["a", "a"], "depth": [0.0]})


def test_split_then_tidy_is_the_profile_pipeline():
    groups = split({"name": ["a", "a"], "nap": [1.0, 2.0], "qc": [1.0, 2.0]})
    assert tidy(groups["a"], "nap")["nap"] == [2.0, 1.0]
