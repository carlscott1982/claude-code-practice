#!/usr/bin/env python3
"""Regenerate the app icons.

Run from the repo root:  python3 docs/icons/make_icons.py
Requires Pillow.  The glyph is three ascending bars, echoing the month view.
"""

from PIL import Image, ImageDraw

ACCENT = (42, 120, 214, 255)  # #2a78d6, the app accent
INK = (255, 255, 255, 255)
OUT = __file__.rsplit("/", 1)[0]


def draw_bars(img, size, inset):
    """Three ascending rounded bars centred in a box inset from the edges."""
    d = ImageDraw.Draw(img)
    box = size - inset * 2
    gap = box * 0.12
    bar_w = (box - gap * 2) / 3
    radius = bar_w / 2
    # Fractional heights of the glyph box, shortest to tallest.
    for i, frac in enumerate((0.42, 0.68, 1.0)):
        x0 = inset + i * (bar_w + gap)
        h = box * frac
        y0 = inset + (box - h)
        d.rounded_rectangle(
            [x0, y0, x0 + bar_w, inset + box],
            radius=radius,
            fill=INK,
        )


def rounded_icon(size, corner_frac, glyph_inset_frac):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=int(size * corner_frac),
        fill=ACCENT,
    )
    draw_bars(img, size, int(size * glyph_inset_frac))
    return img


def main():
    # Standard icons: rounded square, generous glyph.
    for size in (192, 512):
        rounded_icon(size, 0.22, 0.26).save(f"{OUT}/icon-{size}.png")

    # Maskable: full bleed, glyph pulled into the safe zone so a circular
    # or squircle mask never clips it.
    img = Image.new("RGBA", (512, 512), ACCENT)
    draw_bars(img, 512, int(512 * 0.32))
    img.save(f"{OUT}/maskable-512.png")

    # iOS home screen applies its own mask, so ship square with no rounding.
    img = Image.new("RGBA", (180, 180), ACCENT)
    draw_bars(img, 180, int(180 * 0.28))
    img.save(f"{OUT}/apple-touch-icon.png")

    # Favicon for desktop tabs.
    rounded_icon(64, 0.22, 0.22).save(f"{OUT}/favicon.png")

    print("wrote icon-192, icon-512, maskable-512, apple-touch-icon, favicon")


if __name__ == "__main__":
    main()
