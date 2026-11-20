#!/usr/bin/env python3
"""Regenerate the PNG icons in src/icons/ (needs Pillow: pip install pillow).

The glyph geometry below is the same one drawn in-page by buildIcon() in
src/shared.js, so the toolbar icon and the floating ball always match.
Run it with --paths to print the SVG path strings used by buildIcon().
"""
import math
import os
import sys

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 96, 128)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "icons")
SS = 8  # supersampling factor

BG = (22, 24, 29, 255)
RING = (255, 255, 255, 90)
WHITE = (255, 255, 255, 255)

# Glyph geometry in a 24 x 24 box: a 300-degree clockwise arc with an arrowhead.
CX, CY, R = 12.0, 12.0, 6.6
START_DEG, END_DEG = -15.0, 285.0
STROKE = 2.2
HEAD_W, HEAD_H = 2.6, 3.6


def point(deg, radius=R):
    a = math.radians(deg)
    return CX + radius * math.cos(a), CY + radius * math.sin(a)


def glyph():
    """Return (arc_points, head_triangle) in 24-box units, centred on the box."""
    n = 160
    arc = [point(START_DEG + (END_DEG - START_DEG) * i / n) for i in range(n + 1)]
    end = math.radians(END_DEG)
    ex, ey = arc[-1]
    tx, ty = -math.sin(end), math.cos(end)  # clockwise tangent
    nx, ny = math.cos(end), math.sin(end)  # radial normal
    head = [
        (ex + HEAD_W * nx, ey + HEAD_W * ny),
        (ex - HEAD_W * nx, ey - HEAD_W * ny),
        (ex + HEAD_H * tx, ey + HEAD_H * ty),
    ]
    xs = [p[0] for p in arc] + [p[0] for p in head]
    ys = [p[1] for p in arc] + [p[1] for p in head]
    half = STROKE / 2
    dx = 12.0 - ((min(xs) - half) + (max(xs) + half)) / 2
    dy = 12.0 - ((min(ys) - half) + (max(ys) + half)) / 2
    return [(p[0] + dx, p[1] + dy) for p in arc], [(p[0] + dx, p[1] + dy) for p in head]


def render(size):
    canvas = size * SS
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((0, 0, canvas - 1, canvas - 1), fill=BG)

    # Hairline ring, composited (not pasted) so it blends with the dark disc.
    ring_w = max(1, round(canvas * 0.035))
    ring = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse(
        (0, 0, canvas - 1, canvas - 1), outline=RING, width=ring_w
    )
    img = Image.alpha_composite(img, ring)

    arc, head = glyph()
    unit = canvas * (0.66 if size <= 32 else 0.60) / 24.0
    off = canvas / 2 - 12.0 * unit

    def px(p):
        return off + p[0] * unit, off + p[1] * unit

    width = max(2, round(STROKE * (1.35 if size <= 32 else 1.0) * unit))
    glyph_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glyph_layer)

    # Perfect circular arc (not a polyline) so the edge stays smooth. The
    # circle's centre is recovered from the arc's first point.
    (x0, y0), (x1, y1) = px(arc[0]), px(arc[-1])
    radius = R * unit
    sa = math.radians(START_DEG)
    cx, cy = x0 - radius * math.cos(sa), y0 - radius * math.sin(sa)
    box = (cx - radius - width / 2, cy - radius - width / 2,
           cx + radius + width / 2, cy + radius + width / 2)
    g.arc(box, START_DEG % 360, END_DEG % 360, fill=WHITE, width=width)
    for (qx, qy) in ((x0, y0), (x1, y1)):
        r = width / 2
        g.ellipse((qx - r, qy - r, qx + r, qy + r), fill=WHITE)
    g.polygon([px(p) for p in head], fill=WHITE)
    img = Image.alpha_composite(img, glyph_layer)
    return img.resize((size, size), Image.LANCZOS)


def svg_paths():
    arc, head = glyph()

    def f(p):
        return f"{p[0]:.2f} {p[1]:.2f}"

    arc_d = f"M{f(arc[0])}A{R} {R} 0 1 1 {f(arc[-1])}"
    head_d = "M" + "L".join(f(p) for p in head) + "Z"
    return arc_d, head_d


if __name__ == "__main__":
    if "--paths" in sys.argv:
        arc_d, head_d = svg_paths()
        print("ARC  ", arc_d)
        print("HEAD ", head_d)
        sys.exit(0)
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        render(s).save(os.path.join(OUT, f"icon{s}.png"), optimize=True)
    print("wrote", ", ".join(f"icon{s}.png" for s in SIZES))
