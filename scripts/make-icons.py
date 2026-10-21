"""Genera l'icona dell'app (src-tauri/icons/app-icon.png, 1024 px), l'icona della menu bar (scrivania a linee con il
pallino di stato in basso a destra, nera per la barra chiara e bianca per quella scura), i pallini dei menu e i
badge degli aggiornamenti.
Uso: python3 scripts/make-icons.py && npx tauri icon src-tauri/icons/app-icon.png"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / 'src-tauri' / 'icons'


def app_icon(size=1024):
    s = 4  # supersampling per bordi morbidi
    img = Image.new('RGBA', (size * s, size * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad, r = 100 * s, 220 * s
    d.rounded_rectangle([pad, pad, size * s - pad, size * s - pad], r, fill=(207, 169, 121, 255))
    # doghe di rovere
    for i in range(8):
        x = pad + 60 * s + i * 96 * s
        d.rectangle([x, pad + 150 * s, x + 14 * s, size * s - pad - 150 * s], fill=(156, 116, 73, 255))
    # scrivania nera con monitor e pallino di stato
    d.rounded_rectangle([250 * s, 560 * s, 774 * s, 640 * s], 20 * s, fill=(35, 35, 37, 255))
    d.rounded_rectangle([360 * s, 330 * s, 664 * s, 530 * s], 24 * s, fill=(35, 35, 37, 255))
    d.rounded_rectangle([380 * s, 350 * s, 644 * s, 510 * s], 14 * s, fill=(61, 110, 153, 255))
    d.ellipse([640 * s, 230 * s, 800 * s, 390 * s], fill=(46, 157, 87, 255), outline=(255, 255, 255, 255), width=18 * s)
    return img.resize((size, size), Image.LANCZOS)


def tray_icon(glyph, color, px=44):
    """Scrivania con monitor e sedia, tratto spesso; pallino di stato in basso a destra con un bordo trasparente."""
    s = 8
    W = px * s
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = W / 44  # unità: la griglia di disegno è 44 x 44
    t = round(3.2 * u)  # spessore del tratto
    box = lambda x0, y0, x1, y1: [x0 * u, y0 * u, x1 * u, y1 * u]
    # sedia a sinistra: schienale arrotondato, seduta, piede e base
    d.rounded_rectangle(box(3, 8, 14, 24), radius=5.5 * u, outline=glyph, width=t)
    d.rectangle(box(1, 23, 16, 26.2), fill=glyph)
    d.rectangle(box(7, 26, 10.2, 32), fill=glyph)
    d.rectangle(box(3, 32, 14, 35.2), fill=glyph)
    # scrivania a destra: piano, gamba sinistra, cassettiera con un cassetto
    d.rectangle(box(17, 19, 43, 22.2), fill=glyph)
    d.rectangle(box(18, 22, 21.2, 39), fill=glyph)
    d.rectangle(box(30, 22, 43, 39), outline=glyph, width=t)
    d.rectangle(box(30, 28.4, 43, 31.6), fill=glyph)
    # monitor sul piano, con piede
    d.rounded_rectangle(box(24, 4, 41, 15), radius=1.5 * u, outline=glyph, width=t)
    d.rectangle(box(31.4, 15, 33.6, 19), fill=glyph)
    # pallino: prima si scava un anello trasparente, poi si disegna il colore
    cx, cy, r, ring = 36 * u, 36 * u, 7.5 * u, 2.4 * u
    hole = Image.new('L', (W, W), 0)
    ImageDraw.Draw(hole).ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring], fill=255)
    img.putalpha(Image.composite(Image.new('L', (W, W), 0), img.getchannel('A'), hole))
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    return img.resize((px, px), Image.LANCZOS)


def dot(color, px):
    s = 8
    img = Image.new('RGBA', (px * s, px * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = px * s * 0.22
    d.ellipse([m, m, px * s - m, px * s - m], fill=color)
    return img.resize((px, px), Image.LANCZOS)


def badge(color, glyph, px=32):
    """Pallino pieno con un simbolo bianco: 'down' (freccia verso il basso) o 'bang' (punto esclamativo)."""
    s = 8
    W = px * s
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = W / 32  # griglia di disegno 32 x 32
    box = lambda x0, y0, x1, y1: [x0 * u, y0 * u, x1 * u, y1 * u]
    white = (255, 255, 255, 255)
    d.ellipse(box(3, 3, 29, 29), fill=color)
    if glyph == 'down':
        d.rounded_rectangle(box(14.4, 8, 17.6, 19), radius=1.2 * u, fill=white)
        d.polygon([(9.5 * u, 16 * u), (22.5 * u, 16 * u), (16 * u, 23.5 * u)], fill=white)
    else:
        d.rounded_rectangle(box(14.3, 8, 17.7, 19), radius=1.6 * u, fill=white)
        d.ellipse(box(14.1, 20.6, 17.9, 24.4), fill=white)
    return img.resize((px, px), Image.LANCZOS)


if __name__ == '__main__':
    # aggiornamenti: blu con freccia (versione nuova), rosso con "!" (indietro di 4 versioni o più)
    badge((47, 111, 222, 255), 'down').save(ROOT / 'tray' / 'update-available.png')
    badge((235, 64, 52, 255), 'bang').save(ROOT / 'tray' / 'update-outdated.png')
    app_icon().save(ROOT / 'app-icon.png')
    colors = {'working': (46, 197, 94, 255), 'waiting': (235, 64, 52, 255), 'idle': (150, 156, 164, 255)}
    for name, color in colors.items():
        dot(color, 32).save(ROOT / 'tray' / f'dot-{name}.png')
        tray_icon((0, 0, 0, 255), color).save(ROOT / 'tray' / f'light-{name}.png')
        tray_icon((255, 255, 255, 255), color).save(ROOT / 'tray' / f'dark-{name}.png')
