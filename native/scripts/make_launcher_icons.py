#!/usr/bin/env python3
"""Generate Android launcher icons from the same glyph as the web app.

Android adaptive icons are two layers (background + foreground) that the
launcher masks into whatever shape the device uses — circle, squircle,
rounded square. The foreground must sit inside the middle ~66% or the
mask will clip it, which is why the glyph here is inset much further
than in the web icons.

Run from the repo root:  python3 native/scripts/make_launcher_icons.py
Requires Pillow.
"""

import os
from PIL import Image, ImageDraw

ACCENT = (42, 120, 214, 255)  # #2a78d6, matching the app accent
INK = (255, 255, 255, 255)

RES = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "res")

# Android's launcher density buckets, in px per adaptive-icon layer.
DENSITIES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

# Legacy square/round icons for launchers predating adaptive icons.
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def draw_bars(img, size, inset):
    """Three ascending rounded bars, the same glyph as the web icon."""
    d = ImageDraw.Draw(img)
    box = size - inset * 2
    gap = box * 0.12
    bar_w = (box - gap * 2) / 3
    for i, frac in enumerate((0.42, 0.68, 1.0)):
        x0 = inset + i * (bar_w + gap)
        h = box * frac
        d.rounded_rectangle(
            [x0, inset + (box - h), x0 + bar_w, inset + box],
            radius=bar_w / 2,
            fill=INK,
        )


def write(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def main():
    for density, size in DENSITIES.items():
        # Background layer: flat accent, full bleed.
        bg = Image.new("RGBA", (size, size), ACCENT)
        write(os.path.join(RES, f"mipmap-{density}", "ic_launcher_background.png"), bg)

        # Foreground layer: transparent, glyph well inside the safe zone.
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_bars(fg, size, int(size * 0.34))
        write(os.path.join(RES, f"mipmap-{density}", "ic_launcher_foreground.png"), fg)

    for density, size in LEGACY.items():
        square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(square)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=ACCENT)
        draw_bars(square, size, int(size * 0.26))
        write(os.path.join(RES, f"mipmap-{density}", "ic_launcher.png"), square)

        round_icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(round_icon)
        d.ellipse([0, 0, size - 1, size - 1], fill=ACCENT)
        draw_bars(round_icon, size, int(size * 0.30))
        write(os.path.join(RES, f"mipmap-{density}", "ic_launcher_round.png"), round_icon)

    print("wrote adaptive + legacy launcher icons for", len(DENSITIES), "densities")


if __name__ == "__main__":
    main()
