#!/usr/bin/env python3
# The before | after pictures in docs/showcase/, from its manifest.
#
#   python3 -I demo/showcase-pictures.py [docs/showcase/showcase.json]
#
# For each entry in the manifest, reads <name>-before.jpg and <name>-after.jpg
# (the originals, same framing, taken by demo/try-real-app.js or
# demo/try-real-sites.js) and writes <name>.jpg: both side by side under a
# caption with the exact words asked, the app, the model and the time.
# Needs Pillow and the Inter font. Colors are Morse's (design/tokens.css).

import json
import os
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

BG = "#0b0b0c"
LINE = "#2e2e33"
TEXT = "#ededef"
TEXT_2 = "#a0a0a8"
PRIMARY = "#f4f4f5"
PRIMARY_TEXT = "#0b0b0c"

HALF = 1200          # width of each picture in the composite
GUTTER = 32
PAD = 48
RADIUS = 14

FONTS = "/usr/share/fonts/opentype/inter"


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f"Inter-{weight}.otf"), size)


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.size[0] - 1, img.size[1] - 1), radius, fill=255)
    out = Image.new("RGBA", img.size)
    out.paste(img, (0, 0), mask)
    return out


def pill(draw, x, y, label, filled):
    f = font("SemiBold", 24)
    w = draw.textlength(label, font=f)
    box = (x, y, x + w + 36, y + 44)
    if filled:
        draw.rounded_rectangle(box, 22, fill=PRIMARY)
        draw.text((x + 18, y + 8), label, font=f, fill=PRIMARY_TEXT)
    else:
        draw.rounded_rectangle(box, 22, outline=TEXT_2, width=2)
        draw.text((x + 18, y + 8), label, font=f, fill=TEXT)


def meta(e):
    kept = ("still there after a reload" if e["where"] == "web" else "back after quitting and reopening the app") if e["persisted"] else "not kept"
    return f'{e["app"]}  ·  Claude Code ({e["model"]})  ·  {e["seconds"]:.0f} s from Enter to the change  ·  {kept}'


def composite(e, folder):
    before = Image.open(os.path.join(folder, f'{e["name"]}-before.jpg')).convert("RGB")
    after = Image.open(os.path.join(folder, f'{e["name"]}-after.jpg')).convert("RGB")
    h = round(before.size[1] * HALF / before.size[0])
    before = before.resize((HALF, h), Image.LANCZOS)
    after = after.resize((HALF, round(after.size[1] * HALF / after.size[0])), Image.LANCZOS)

    width = PAD * 2 + HALF * 2 + GUTTER
    quote_font, meta_font = font("SemiBold", 40), font("Regular", 26)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    # Wrap the words asked to the width of the picture.
    chars = max(20, int((width - PAD * 2) / probe.textlength("abcdefghij", font=quote_font) * 10))
    lines = textwrap.wrap(f'“{e["ask"]}”', chars)
    line_h = 54
    top = PAD + len(lines) * line_h + 14 + 36 + 36
    labels = 44 + 16
    height = top + labels + max(before.size[1], after.size[1]) + PAD

    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    y = PAD
    for line in lines:
        draw.text((PAD, y), line, font=quote_font, fill=TEXT)
        y += line_h
    draw.text((PAD, y + 14), meta(e), font=meta_font, fill=TEXT_2)

    for i, (img, label) in enumerate(((before, "Before"), (after, "After"))):
        x = PAD + i * (HALF + GUTTER)
        pill(draw, x, top, label, filled=i == 1)
        iy = top + labels
        draw.rounded_rectangle((x - 1, iy - 1, x + img.size[0], iy + img.size[1]), RADIUS + 1, outline=LINE, width=2)
        canvas.paste(rounded(img, RADIUS), (x, iy), rounded(img, RADIUS))
    out = os.path.join(folder, f'{e["name"]}.jpg')
    canvas.save(out, "JPEG", quality=84, optimize=True, progressive=True)
    return out


def main():
    manifest = sys.argv[1] if len(sys.argv) > 1 else "docs/showcase/showcase.json"
    folder = os.path.dirname(manifest)
    with open(manifest, encoding="utf-8") as f:
        entries = json.load(f)["changes"]
    for e in entries:
        print(composite(e, folder))


if __name__ == "__main__":
    main()
