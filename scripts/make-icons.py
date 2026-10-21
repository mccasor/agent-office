"""Genera l'icona dell'app (src-tauri/icons/app-icon.png, 1024 px) e i pallini della menu bar (verde, rosso, grigio).
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


def dot(color, px):
    s = 8
    img = Image.new('RGBA', (px * s, px * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = px * s * 0.22
    d.ellipse([m, m, px * s - m, px * s - m], fill=color)
    return img.resize((px, px), Image.LANCZOS)


if __name__ == '__main__':
    app_icon().save(ROOT / 'app-icon.png')
    for name, color in {'working': (46, 197, 94, 255), 'waiting': (235, 64, 52, 255), 'idle': (150, 156, 164, 255)}.items():
        dot(color, 44).save(ROOT / 'tray' / f'{name}.png')
