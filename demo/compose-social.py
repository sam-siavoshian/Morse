#!/usr/bin/env python3
"""Draws the frames of one format of the social cut and encodes them.

    python3 demo/compose-social.py edl.json out.mp4

edl.json comes from demo/social-edit.js: the canvas, where the picture goes,
and for every frame the source frame, the camera's crop of it (in frame
pixels, fractional), the cursor, the click ripples and the overlays (words,
labels, the end card). The crop is resampled with sub-pixel precision, so slow
camera moves glide instead of stepping a pixel at a time. Needs Pillow.
"""
import json
import subprocess
import sys

from PIL import Image, ImageDraw

edl = json.load(open(sys.argv[1]))
out = sys.argv[2]
W, H, FPS = edl["w"], edl["h"], edl["fps"]
pic = edl["pic"]
PW, PH = pic["w"], pic["h"]
SRCW = edl.get("srcw", 1920)  # the frame width the crops are given in
bg = Image.new("RGB", (W, H), tuple(edl["bg"]))

ff = subprocess.Popen(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-c:v", "libx264", "-preset", "slow", "-crf", str(edl.get("crf", 19)), "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    stdin=subprocess.PIPE)

_src = {"path": None, "img": None}
def source(p):
    if _src["path"] != p:
        _src["img"] = Image.open(p).convert("RGB")
        _src["path"] = p
    return _src["img"]

_ov = {}
def overlay(path, alpha, scale):
    a, s = round(alpha, 2), round(scale, 3)
    key = (path, a, s)
    if key in _ov:
        return _ov[key]
    img = _ov.get((path, 1.0, 1.0))
    if img is None:
        img = Image.open(path).convert("RGBA")
        _ov[(path, 1.0, 1.0)] = img
    if s != 1.0:
        img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    if a < 1.0:
        r, g, b, al = img.split()
        al = al.point(lambda v: round(v * a))
        img = Image.merge("RGBA", (r, g, b, al))
    if len(_ov) > 400:
        _ov.clear()
    _ov[key] = img
    return img

cursor_src = Image.open(edl["cursor"]).convert("RGBA")
# The arrow's tip in the cursor picture (drawn at 4x, 12 px padding, tip at 3,2 of 24).
TIP = (12 + 3 * 4, 12 + 2 * 4)
_cur = {}
def cursor(size, pressed):
    key = (round(size), pressed)
    if key not in _cur:
        k = size / (24 * 4) * (0.86 if pressed else 1.0)
        img = cursor_src.resize((max(1, round(cursor_src.width * k)), max(1, round(cursor_src.height * k))), Image.LANCZOS)
        _cur[key] = (img, (TIP[0] * k, TIP[1] * k))
    return _cur[key]

def put(dst, src, x, y):
    """alpha_composite that allows a position partly off the picture."""
    x, y = int(round(x)), int(round(y))
    l, t = max(0, -x), max(0, -y)
    r, b = min(src.width, dst.width - x), min(src.height, dst.height - y)
    if r <= l or b <= t:
        return
    dst.alpha_composite(src.crop((l, t, r, b)) if (l, t, r, b) != (0, 0, src.width, src.height) else src, (x + l, y + t))

def ripple(layer, x, y, age, s):
    # A soft ring that grows and fades over half a second, drawn at 4x and scaled down (smooth edges).
    u = min(1.0, age / 0.5)
    e = 1 - (1 - u) ** 3
    r = (7 + 20 * e) * s
    alpha = int(150 * (1 - u) ** 1.6)
    if alpha <= 2:
        return
    R = int(r + 4)
    big = Image.new("RGBA", (R * 8, R * 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    c = R * 4
    d.ellipse([c - r * 4, c - r * 4, c + r * 4, c + r * 4], fill=(255, 255, 255, alpha // 3), outline=(255, 255, 255, alpha), width=max(4, int(2.2 * s * 4)))
    small = big.resize((R * 2, R * 2), Image.LANCZOS)
    put(layer, small, x - R, y - R)

for f in edl["frames"]:
    canvas = bg.copy().convert("RGBA")
    if f.get("src"):
        cx, cy, cw, ch = f["crop"]
        img = source(f["src"])
        k = img.width / SRCW  # a browser screencast may come at CSS size (1280 wide)
        part = img.transform((PW, PH), Image.AFFINE, (cw / PW * k, 0, cx * k, 0, ch / PH * k, cy * k), resample=Image.BICUBIC).convert("RGBA")
        s = PW / cw
        for rx, ry, age in f.get("rip", []):
            ripple(part, (rx - cx) * s, (ry - cy) * s, age, s ** 0.6)
        c = f.get("cur")
        if c:
            x, y = (c[0] - cx) * s, (c[1] - cy) * s
            if -40 < x < PW + 10 and -40 < y < PH + 10:
                img_c, tip = cursor(34 * s ** 0.6 * (PW / 1728) ** 0.3, bool(c[2]))
                put(part, img_c, x - tip[0], y - tip[1])
        canvas.alpha_composite(part, (pic["x"], pic["y"]))
    for path, x, y, alpha, scale in f.get("ov", []):
        if alpha <= 0.01:
            continue
        o = overlay(path, alpha, scale)
        if x == "center":
            x = (W - o.width) // 2
        elif scale != 1.0:
            # Scaled about the canvas centre (full-canvas layers).
            x = int(round((W - o.width) / 2))
            y = int(round((H - o.height) / 2))
        put(canvas, o, x, y)
    ff.stdin.write(canvas.convert("RGB").tobytes())

ff.stdin.close()
sys.exit(ff.wait())
