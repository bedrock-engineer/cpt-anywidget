"""The vertical coordinate, in one place.

What a vertical coordinate *is* — its data key, direction, axis label,
readout format — plus the datum arithmetic that goes with it. The front
end never sees datums: every synced value expressed in the vertical
coordinate (cptData columns, annotation ``at``, layer ``top``/``bottom``)
is converted Python-side through this module. The display defaults are
mirrored by ``verticalDefaults`` in js/lib/vertical.ts; change them
together.
"""

import dataclasses


@dataclasses.dataclass
class Vertical:
    """Binding of a data column to the vertical coordinate, mirroring
    :class:`~cpt_anywidget.cpt_viewer.Channel`: only ``key`` is
    required; omitted fields fall back to the built-in defaults for
    "depth" and "nap", and for any other key to a depth-like coordinate
    labeled by its key. Pass one anywhere a vertical key string goes to
    plot against a datum the package has never heard of, e.g.
    ``Vertical("taw", label="TAW [m]", up=True, format="+.2f")``.
    """

    key: str
    label: str | None = None  # full axis title, e.g. "NAP [m]"
    up: bool | None = None  # positive up (elevation) vs down (depth)
    format: str | None = None  # d3 format for readouts, e.g. "+.2f"

    def spec(self):
        """The verticalKey-trait value: omitted fields dropped so the
        front end's defaults still apply, collapsed to the bare key
        string when nothing else is set."""
        spec = {
            k: v for k, v in dataclasses.asdict(self).items() if v is not None
        }
        return spec if len(spec) > 1 else self.key


# built-in display defaults for the two BRO vertical coordinates: depth
# below surface (positive down) and NAP elevation (positive up, signed
# so values near the datum read unambiguously)
_DEFAULTS = {
    "depth": Vertical("depth", "depth [m]", up=False, format=".2f"),
    "nap": Vertical("nap", "NAP [m]", up=True, format="+.2f"),
}


def resolve_vertical(vertical):
    """A fully populated :class:`Vertical` from anything callers hand a
    ``vertical`` argument: a key string, a :class:`Vertical`, or a raw
    spec dict. Explicit fields win over the key's built-in defaults;
    unknown keys read as depth-like (positive down), labeled by their
    key.
    """
    if isinstance(vertical, str):
        vertical = Vertical(vertical)
    elif isinstance(vertical, dict):
        vertical = Vertical(**vertical)
    default = _DEFAULTS.get(vertical.key) or Vertical(
        vertical.key, vertical.key, up=False, format=".2f"
    )
    return dataclasses.replace(
        default,
        **{
            k: v
            for k, v in dataclasses.asdict(vertical).items()
            if v is not None
        },
    )


def from_vertical(value, offset, vertical_key):
    """Convert a value in the selected vertical coordinate back to depth
    below surface — the inverse of :func:`to_vertical`.

    The positive-up mapping ``v = offset - d`` is an involution, so the
    inverse is the same arithmetic; this wrapper exists so call sites say
    which direction they mean.
    """
    return to_vertical(value, offset, vertical_key)


def to_vertical(depth, offset, vertical_key):
    """Convert a depth below surface to the selected vertical coordinate.

    ``depth`` — m below surface (positive down); ``None`` (a missing
    sample) passes through. brodata sometimes yields numeric strings,
    so both arguments are coerced with ``float``.
    ``offset`` — surface elevation in the target datum; only used for
    positive-up coordinates.
    ``vertical_key`` — a key string, :class:`Vertical`, or spec dict;
    depth-like keys return the depth unchanged, positive-up ones
    (``"nap"``, or ``up=True``) return ``offset - depth``.
    """
    if depth is None:
        return None
    d = float(depth)
    return float(offset) - d if resolve_vertical(vertical_key).up else d
