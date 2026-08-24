"""Data intake: contract enforcement between whatever parsed your CPT
data and the widgets' wire format.

The package never parses formats, converts units, or renames columns —
readers (brodata, pygef, python-ags4, a csv, ...) stay upstream, and
:class:`~cpt_anywidget.cpt_viewer.Channel` /
:class:`~cpt_anywidget.vertical.Vertical` bindings adapt the chart to
whatever the columns are called. What *must* happen here, because the
front end cannot recover from it, is the bare minimum:

- JSON-safety: NaN/inf → None (NaN is invalid JSON and kills the trait
  sync), numpy scalars unwrapped. Nothing else is coerced — a
  non-numeric sample is the reader's bug and raises immediately.
- equal-length validation: every column is indexed by the vertical
  sample position, so a ragged dict would silently misalign channels.
- render order: rows sorted so the first sample is the topmost, the
  order the front end renders in; samples without a vertical value
  cannot be placed and are dropped.

The viewer constructors also share :func:`_normalize_traits` here — the
facade's ``vertical``/``channels``/``limits`` kwargs rendered into their
traits, in one place.

See docs/adr/0002-intake-is-contract-enforcement-only.md.
"""

import math

from cpt_anywidget.vertical import resolve_vertical


def _json_safe(key, value):
    """One JSON-safe sample; anything non-numeric raises with the
    column and offending value named."""
    if hasattr(value, "item"):  # numpy scalar
        value = value.item()
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value
    raise ValueError(
        f"column {key!r} holds a non-numeric sample: {value!r} "
        f"({type(value).__name__}) — coerce numerics upstream, e.g. "
        "pd.to_numeric(...) or .cast(pl.Float64)"
    )


def _as_lists(data):
    """DataFrame or mapping → {name: list}, column names stringified.

    A dict of column iterables and a pandas DataFrame both expose
    ``.items()``; a polars DataFrame goes via ``to_dict(as_series=False)``
    — no dataframe import happens here either way. Anything else raises
    with the type named, instead of leaking an AttributeError.
    """
    if not hasattr(data, "items"):
        try:
            data = data.to_dict(as_series=False)  # polars DataFrame
        except (AttributeError, TypeError):
            raise ValueError(
                f"data must be a polars/pandas DataFrame or a dict of "
                f"columns, got {type(data).__name__} — convert to a dict "
                f"of columns first (e.g. pyarrow's .to_pydict())"
            ) from None
    return {str(k): list(v) for k, v in data.items()}


def tidy(data, vertical="depth"):
    """Tidy columns → the wire-ready ``cptData`` dict.

    ``data`` — a polars or pandas DataFrame, or dict of equal-length
    columns: one row per depth sample, one column per measurement,
    whatever the columns are called.
    ``vertical`` — the column that places rows on the vertical axis: a
    key string, :class:`~cpt_anywidget.vertical.Vertical` binding, or
    spec dict. Rows sort ascending for depth-like coordinates and
    descending for positive-up ones (``"nap"``, or ``up=True``), so the
    first sample is the topmost either way.

    Returns exactly what the widget will receive: plain lists, JSON-safe
    samples, rows in render order. Call it directly to inspect or test
    that; the viewer constructors call it for you.
    """
    vert = resolve_vertical(vertical)
    columns = _as_lists(data)
    lengths = {k: len(v) for k, v in columns.items()}
    if len(set(lengths.values())) > 1:
        raise ValueError(f"columns differ in length: {lengths}")
    columns = {k: [_json_safe(k, s) for s in v] for k, v in columns.items()}
    if vert.key not in columns:
        raise ValueError(
            f"vertical column {vert.key!r} not in data "
            f"(columns: {sorted(columns)})"
        )
    values = columns[vert.key]
    order = [i for i, v in enumerate(values) if v is not None]
    order.sort(key=values.__getitem__, reverse=vert.up)
    return {name: [vals[i] for i in order] for name, vals in columns.items()}


def split(data, name="name"):
    """Tidy *long* columns → {name: columns}, one group per CPT.

    ``data`` — every CPT's samples stacked in one DataFrame or dict of
    columns, with the ``name`` column telling them apart. Groups keep
    first-appearance order and drop the name column; each group is raw —
    feed it to :func:`tidy` (the :class:`ProfileViewer` constructor
    composes exactly that).
    """
    columns = _as_lists(data)
    if name not in columns:
        raise ValueError(
            f"name column {name!r} not in data (columns: {sorted(columns)})"
        )
    names = [str(n) for n in columns.pop(name)]
    lengths = {k: len(v) for k, v in columns.items()}
    if any(n != len(names) for n in lengths.values()):
        raise ValueError(
            f"columns differ in length from the name column "
            f"({len(names)} rows): {lengths}"
        )
    rows = {}
    for i, n in enumerate(names):
        rows.setdefault(n, []).append(i)
    return {
        n: {k: [v[i] for i in index] for k, v in columns.items()}
        for n, index in rows.items()
    }


def _normalize_traits(*, vertical=None, channels=None, limits=None, default):
    """The constructor facades' shared trio: ``vertical``/``channels``/
    ``limits`` kwargs → their trait entries, plus the resolved
    :class:`~cpt_anywidget.vertical.Vertical` the data path sorts by.

    ``default`` — what the vertical falls back to when ``vertical`` is
    absent: the raw ``verticalKey`` kwarg if the caller passed one, else
    the viewer's trait default. Bindings are recognized by their
    ``spec`` method (:class:`~cpt_anywidget.cpt_viewer.Channel`,
    :class:`~cpt_anywidget.vertical.Vertical` — no viewer import here);
    plain strings and dicts pass through untouched, so the front end's
    display defaults still apply.
    """
    vert = resolve_vertical(vertical if vertical is not None else default)
    out = {}
    if vertical is not None:
        out["verticalKey"] = (
            vertical.spec() if hasattr(vertical, "spec") else vertical
        )
    if channels is not None:
        out["channels"] = [
            c.spec() if hasattr(c, "spec") else c for c in channels
        ]
    if limits is not None:
        # the vertical pair is oriented to the render direction (highest
        # sample first when positive-up), so callers can pass it either
        # way round; other keys pass through as given
        out["axisLimits"] = {
            k: sorted(v, reverse=vert.up) if k == vert.key else list(v)
            for k, v in limits.items()
        }
    return vert, out
