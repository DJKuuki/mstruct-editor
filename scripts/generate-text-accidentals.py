"""Build the OFL text-only accidental subset; requires fontTools and Brotli.

Run from any directory with the editor's existing npm dependencies installed.
The committed output is used at runtime; Python is not a build dependency.
"""

import hashlib
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "node_modules/@fontsource/noto-music"
SOURCE = PACKAGE / "files/noto-music-music-400-normal.woff2"
SOURCE_SHA256 = "671f8700874718cf53239e658af8649c9694e65664fcc26468107551f3583e82"
OUTPUT = ROOT / "public/fonts/MStructTextAccidentals.woff2"
CODEPOINTS = (0x266D, 0x266E, 0x266F, 0x1D12A, 0x1D12B)

if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
    raise SystemExit("Noto Music 5.2.5 source bytes changed; review before regenerating.")

font = TTFont(SOURCE, recalcTimestamp=False)
cmap = font.getBestCmap()
original = {
    codepoint: {
        "bounds": (font["glyf"][cmap[codepoint]].yMin, font["glyf"][cmap[codepoint]].yMax),
        "advance": font["hmtx"][cmap[codepoint]],
    }
    for codepoint in CODEPOINTS
}
# Flat/double-flat share -55 units. Keep all other glyphs and advance widths.
baseline = original[0x266D]["bounds"][0]
shifts = {}
for codepoint in (0x266E, 0x266F):
    glyph = font["glyf"][cmap[codepoint]]
    assert not glyph.isComposite()
    shift = baseline - glyph.yMin
    glyph.coordinates.translate((0, shift))
    glyph.recalcBounds(font["glyf"])
    shifts[f"U+{codepoint:04X}"] = shift

options = subset.Options()
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 10, 13, 14, 16, 17]
options.name_languages = [0x409]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=CODEPOINTS)
subsetter.subset(font)
names = {
    1: "MStruct Text Accidentals", 2: "Regular",
    3: "MStructTextAccidentals-Regular-1.0", 4: "MStruct Text Accidentals Regular",
    5: "Version 1.000", 6: "MStructTextAccidentals-Regular",
    10: "Text subset derived from Noto Music via @fontsource/noto-music 5.2.5. "
        "Sharp raised 192/1000 em; natural raised 166/1000 em. Other glyphs and advances unchanged.",
    16: "MStruct Text Accidentals", 17: "Regular",
}
for name_id, value in names.items():
    font["name"].removeNames(nameID=name_id)
    font["name"].setName(value, name_id, 3, 1, 0x409)
font.flavor = "woff2"
font.save(OUTPUT)

verified = TTFont(OUTPUT)
for codepoint in CODEPOINTS:
    glyph_name = verified.getBestCmap()[codepoint]
    glyph = verified["glyf"][glyph_name]
    assert verified["hmtx"][glyph_name] == original[codepoint]["advance"]
    if codepoint in (0x266E, 0x266F):
        assert glyph.yMin == baseline
        assert glyph.yMax - glyph.yMin == original[codepoint]["bounds"][1] - original[codepoint]["bounds"][0]
    else:
        assert (glyph.yMin, glyph.yMax) == original[codepoint]["bounds"]

notice = (
    "MStruct Text Accidentals is a modified five-glyph text subset of Noto Music.\n"
    "Original: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/music).\n"
    "Modification: sharp +192 and natural +166 font units (1000 units/em), family renamed.\n"
    "Flat, double-flat, double-sharp, horizontal advances and other outlines are unchanged.\n"
    "Source: @fontsource/noto-music 5.2.5, music-400-normal WOFF2.\n"
    "The derivative remains licensed under SIL OFL 1.1; the upstream license follows.\n\n"
)
(OUTPUT.parent / "OFL-MStructTextAccidentals.txt").write_text(
    notice + (PACKAGE / "LICENSE").read_text(encoding="utf-8"), encoding="utf-8"
)
print(json.dumps({"font": str(OUTPUT), "sourceSha256": SOURCE_SHA256, "shifts": shifts,
                  "outputSha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest()}))
