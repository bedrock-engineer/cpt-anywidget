"""Datum arithmetic, in one place.

The front end never sees datums: every synced value expressed in the
vertical coordinate (cptData columns, annotation ``at``, layer
``top``/``bottom``) is converted Python-side, and this is the single
home of that conversion — the notebook and the viewer helpers all
import it.
"""


def from_vertical(value, offset, vertical_key):
    """Convert a value in the selected vertical coordinate back to depth
    below surface — the inverse of :func:`to_vertical`.

    The ``"nap"`` mapping ``v = offset - d`` is an involution, so the
    inverse is the same arithmetic; this wrapper exists so call sites say
    which direction they mean.
    """
    return to_vertical(value, offset, vertical_key)


def to_vertical(depth, offset, vertical_key):
    """Convert a depth below surface to the selected vertical coordinate.

    ``depth`` — m below surface (positive down); ``None`` (a missing
    sample) passes through. brodata sometimes yields numeric strings,
    so both arguments are coerced with ``float``.
    ``offset`` — surface elevation in m NAP; only used for ``"nap"``.
    ``vertical_key`` — ``"depth"`` returns the depth unchanged,
    ``"nap"`` returns ``offset - depth`` (positive up).
    """
    if depth is None:
        return None
    d = float(depth)
    return float(offset) - d if vertical_key == "nap" else d
