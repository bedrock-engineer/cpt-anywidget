"""BRO lithology display table.

Maps BRO geotechnical soil names to proportional soil-composition
sub-bands: ``{"width", "color", "hatch"?}`` with widths summing to <= 1
and hatch a matplotlib-style pattern char. Vendored (colors converted
to hex) from brodata's ``get_bro_lithology_properties`` (brodata 0.1.8,
MIT, (c) 2026 Artesia Water) so the borehole converters need no
runtime dependency.
"""

BRO_LITHOLOGY = {
    "veen": [{"width": 1, "color": "#994c3a", "hatch": "-"}],
    "klei": [{"width": 1, "color": "#009608", "hatch": "/"}],
    "leem": [{"width": 1, "color": "#dbdbdb", "hatch": "\\"}],
    "zand": [{"width": 1, "color": "#fefe08", "hatch": "."}],
    "grind": [{"width": 1, "color": "#f3c027", "hatch": "o"}],
    "silt": [{"width": 1, "color": "#dbdbdb", "hatch": "|"}],
    "nietBepaald": [{"width": 1, "color": "#7030a0"}],
    "grondNietGespecificeerd": [{"width": 1, "color": "#ffffff"}],
    "mineraalarmVeen": [{"width": 1, "color": "#994c3a", "hatch": "-"}],
    "zwakZandigVeen": [{"width": 0.8333333333333334, "color": "#994c3a", "hatch": "-"}, {"width": 0.16666666666666666, "color": "#fefe08", "hatch": "."}],
    "sterkZandigVeen": [{"width": 0.6833333333333333, "color": "#994c3a", "hatch": "-"}, {"width": 0.31666666666666665, "color": "#fefe08", "hatch": "."}],
    "zwakKleiigVeen": [{"width": 0.8333333333333334, "color": "#994c3a", "hatch": "-"}, {"width": 0.16666666666666666, "color": "#009608", "hatch": "/"}],
    "sterkKleiigVeen": [{"width": 0.6833333333333333, "color": "#994c3a", "hatch": "-"}, {"width": 0.31666666666666665, "color": "#009608", "hatch": "/"}],
    "kleiigVeen": [{"width": 0.7, "color": "#994c3a", "hatch": "-"}, {"width": 0.3, "color": "#009608", "hatch": "/"}],
    "zwakZandigSilt": [{"width": 0.8, "color": "#dbdbdb", "hatch": "|"}, {"width": 0.2, "color": "#fefe08", "hatch": "."}],
    "zwakGrindigeKlei": [{"width": 0.8, "color": "#009608", "hatch": "/"}, {"width": 0.2, "color": "#f3c027", "hatch": "o"}],
    "zwakZandigeKlei": [{"width": 0.8, "color": "#009608", "hatch": "/"}, {"width": 0.2, "color": "#fefe08", "hatch": "."}],
    "zwakZandigeKleiMetGrind": [{"width": 0.8, "color": "#009608", "hatch": "/"}, {"width": 0.2, "color": "#fefe08", "hatch": "."}],
    "matigZandigeKlei": [{"width": 0.6833333333333333, "color": "#009608", "hatch": "/"}, {"width": 0.31666666666666665, "color": "#fefe08", "hatch": "."}],
    "sterkZandigeKlei": [{"width": 0.5, "color": "#009608", "hatch": "/"}, {"width": 0.5, "color": "#fefe08", "hatch": "."}],
    "sterkZandigeKleiMetGrind": [{"width": 0.6, "color": "#009608", "hatch": "/"}, {"width": 0.4, "color": "#dbdbdb", "hatch": "\\"}],
    "zwakSiltigeKlei": [{"width": 0.8333333333333334, "color": "#009608", "hatch": "/"}, {"width": 0.16666666666666666, "color": "#dbdbdb", "hatch": "\\"}],
    "matigSiltigeKlei": [{"width": 0.6833333333333333, "color": "#009608", "hatch": "/"}, {"width": 0.31666666666666665, "color": "#dbdbdb", "hatch": "\\"}],
    "sterkSiltigeKlei": [{"width": 0.5, "color": "#009608", "hatch": "/"}, {"width": 0.5, "color": "#dbdbdb", "hatch": "\\"}],
    "uiterstSiltigeKlei": [{"width": 0.43333333333333335, "color": "#009608", "hatch": "/"}, {"width": 0.5666666666666667, "color": "#dbdbdb"}],
    "zwakZandigeLeem": [{"width": 0.8333333333333334, "color": "#dbdbdb", "hatch": "\\"}, {"width": 0.16666666666666666, "color": "#fefe08", "hatch": "."}],
    "sterkZandigeLeem": [{"width": 0.5, "color": "#dbdbdb", "hatch": "\\"}, {"width": 0.5, "color": "#fefe08", "hatch": "."}],
    "zwakGrindigZand": [{"width": 0.8, "color": "#fefe08", "hatch": "."}, {"width": 0.2, "color": "#f3c027", "hatch": "o"}],
    "sterkGrindigZand": [{"width": 0.6, "color": "#fefe08", "hatch": "."}, {"width": 0.4, "color": "#f3c027", "hatch": "o"}],
    "zwakSiltigZand": [{"width": 0.8333333333333334, "color": "#fefe08", "hatch": "."}, {"width": 0.16666666666666666, "color": "#dbdbdb", "hatch": "\\"}],
    "matigSiltigZand": [{"width": 0.6833333333333333, "color": "#fefe08", "hatch": "."}, {"width": 0.31666666666666665, "color": "#dbdbdb", "hatch": "\\"}],
    "sterkSiltigZand": [{"width": 0.5, "color": "#fefe08", "hatch": "."}, {"width": 0.5, "color": "#dbdbdb", "hatch": "\\"}],
    "siltigZandMetGrind": [{"width": 0.7, "color": "#fefe08", "hatch": "."}, {"width": 0.3, "color": "#dbdbdb", "hatch": "|"}],
    "kleiigZand": [{"width": 0.8333333333333334, "color": "#fefe08", "hatch": "."}, {"width": 0.16666666666666666, "color": "#009608", "hatch": "/"}],
    "kleiigZandMetGrind": [{"width": 0.7, "color": "#fefe08", "hatch": "."}, {"width": 0.3, "color": "#009608", "hatch": "/"}],
    "siltigZand": [{"width": 0.7, "color": "#fefe08", "hatch": "."}, {"width": 0.3, "color": "#dbdbdb", "hatch": "|"}],
    "zwakZandigGrind": [{"width": 0.8, "color": "#f3c027", "hatch": "o"}, {"width": 0.2, "color": "#fefe08", "hatch": "."}],
    "sterkZandigGrind": [{"width": 0.6, "color": "#f3c027", "hatch": "o"}, {"width": 0.4, "color": "#fefe08", "hatch": "."}],
    "zandNietGespecificeerd": [{"width": 0.4, "color": "#fefe08", "hatch": "."}, {"width": 0.6, "color": "#ffffff"}],
}
