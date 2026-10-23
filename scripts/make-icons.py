"""Genera l'icona dell'app (src-tauri/icons/app-icon.png, 1024 px) e quelle della menu bar (src-tauri/icons/tray), in
pixel art come l'ufficio.
- App: l'arte 24x24 di scripts/icons/app-art.png (parete, monitor con il codice, scrivania; palette degli sprite)
  ingrandita a scala intera dentro lo squircle di macOS, con bordo scuro e ombra.
- Menu bar: silhouette piena 22x22 (monitor con il codice in negativo, scrivania) raddoppiata a 44x44, nera per la
  barra chiara e bianca per quella scura, con il pallino di stato a pixel in basso a destra.
Uso: python3 scripts/make-icons.py && npx tauri icon src-tauri/icons/app-icon.png"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parent.parent
ICONS = REPO / "src-tauri" / "icons"
ART = REPO / "scripts" / "icons" / "app-art.png"
# contorno scuro della palette degli sprite (PALETTE.outline)
OUTLINE = (42, 26, 38)


def squircle_mask(size, box, n=5.0, ss=4):
    """Superellisse |x|^n + |y|^n <= 1 (la forma continua delle icone macOS), antialias per supersampling."""
    S = size * ss
    c = (S - 1) / 2
    r = box * ss / 2
    y, x = np.mgrid[0:S, 0:S]
    v = np.abs((x - c) / r) ** n + np.abs((y - c) / r) ** n
    return Image.fromarray(((v <= 1) * 255).astype(np.uint8)).resize(
        (size, size), Image.LANCZOS
    )


def app_icon(art, size=1024):
    """Arte ingrandita a scala intera (nearest) nello squircle: ~816 px su 1024, come la griglia delle icone Apple."""
    scale = 824 // art.width
    box = art.width * scale
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - box) // 2
    layer.paste(art.convert("RGBA").resize((box, box), Image.NEAREST), (off, off))
    mask = squircle_mask(size, box)
    # bordo interno sottile nel colore di contorno, come gli sprite
    inner = squircle_mask(size, box - 2 * max(4, scale // 3))
    ring = np.clip(
        np.asarray(mask, np.int16) - np.asarray(inner, np.int16), 0, 255
    ).astype(np.uint8)
    border = Image.new("RGBA", (size, size), OUTLINE + (255,))
    border.putalpha(Image.fromarray(ring).point(lambda a: a * 150 // 255))
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    body.paste(layer, (0, 0), mask)
    body.alpha_composite(border)
    # ombra morbida sotto
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow.paste(
        (0, 0, 0, 255),
        (0, 10, size, size),
        mask.filter(ImageFilter.GaussianBlur(14))
        .point(lambda a: a * 90 // 255)
        .crop((0, 0, size, size - 10)),
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(body)
    return out


STATUS = {"working": (46, 197, 94), "waiting": (235, 64, 52), "idle": (150, 156, 164)}
# pallino di stato: 8x8 pixel d'arte in basso a destra, con un anello trasparente attorno
DOT = [
    "..####..",
    ".######.",
    "########",
    "########",
    "########",
    "########",
    ".######.",
    "..####..",
]
DOT_X, DOT_Y = 14, 14


class Grid:
    """Griglia 22x22 di colori (None = trasparente)."""

    def __init__(self, n=22):
        self.n = n
        self.c = [[None] * n for _ in range(n)]

    def px(self, x, y, col):
        if 0 <= x < self.n and 0 <= y < self.n:
            self.c[y][x] = col

    def rect(self, x, y, w, h, col):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.px(i, j, col)

    def dot(self, col):
        """Scava l'anello trasparente e disegna il pallino, con bordo più scuro e un punto di luce."""
        inside = lambda i, j: 0 <= i < 8 and 0 <= j < 8 and DOT[j][i] == "#"
        for j in range(-1, 9):
            for i in range(-1, 9):
                if any(
                    inside(i + di, j + dj)
                    for di, dj in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]
                ):
                    self.px(DOT_X + i, DOT_Y + j, None)
        dark = tuple(int(v * 0.72) for v in col)
        light = tuple(min(255, int(v + (255 - v) * 0.55)) for v in col)
        for j in range(8):
            for i in range(8):
                if inside(i, j):
                    edge = not all(
                        inside(i + di, j + dj)
                        for di, dj in [(1, 0), (-1, 0), (0, 1), (0, -1)]
                    )
                    self.px(DOT_X + i, DOT_Y + j, dark if edge else col)
        self.px(DOT_X + 2, DOT_Y + 2, light)

    def image(self, scale=2):
        img = Image.new("RGBA", (self.n, self.n), (0, 0, 0, 0))
        for y in range(self.n):
            for x in range(self.n):
                if self.c[y][x] is not None:
                    img.putpixel((x, y), self.c[y][x] + (255,))
        return img.resize((self.n * scale, self.n * scale), Image.NEAREST)


def tray_icon(ink, color):
    """Monitor pieno con le righe di codice in negativo, piede, scrivania con due gambe; pallino di stato."""
    g = Grid()
    g.rect(2, 1, 18, 12, ink)
    for y, segs in [
        (3, [(4, 3), (8, 5)]),
        (5, [(6, 2), (9, 6)]),
        (7, [(6, 7)]),
        (9, [(4, 2), (7, 4)]),
    ]:
        for x, w in segs:
            g.rect(x, y, w, 1, None)
    g.rect(9, 13, 4, 2, ink)
    g.rect(6, 14, 10, 1, ink)
    g.rect(0, 16, 22, 2, ink)
    g.rect(1, 18, 3, 4, ink)
    g.rect(18, 18, 3, 4, ink)
    g.dot(color)
    return g.image(2)


if __name__ == "__main__":
    app_icon(Image.open(ART)).save(ICONS / "app-icon.png")
    for name, color in STATUS.items():
        tray_icon((0, 0, 0), color).save(ICONS / "tray" / f"light-{name}.png")
        tray_icon((255, 255, 255), color).save(ICONS / "tray" / f"dark-{name}.png")
