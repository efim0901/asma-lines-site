# -*- coding: utf-8 -*-
"""
Сборка наглядных сравнений для отчёта: «до/после» по технике и обе темы.

Запуск:
    python _tools/make-comparison.py
"""

import os

from PIL import Image, ImageDraw, ImageFont

OUT = "_shots"
WIDTH = 880
LABEL_HEIGHT = 40

BG = (255, 255, 255)
PAPER = (250, 249, 245)
INK = (24, 21, 22)
BRAND = (107, 30, 45)
MUTED = (118, 112, 115)


def font(size):
    """Шрифт с кириллицей: стандартный шрифт Pillow её не содержит."""
    for candidate in (
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def load(path, box=None, width=WIDTH):
    image = Image.open(path).convert("RGB")
    if box:
        image = image.crop(box)
    ratio = width / image.width
    return image.resize((width, int(image.height * ratio)))


def card(image, title, subtitle=""):
    """Картинка с подписью сверху, на светлой подложке."""
    height = LABEL_HEIGHT + image.height + (22 if subtitle else 0)
    canvas = Image.new("RGB", (image.width, height), PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.text((14, 11), title, font=font(17), fill=BRAND)
    if subtitle:
        draw.text((14, LABEL_HEIGHT + image.height + 2), subtitle, font=font(14), fill=MUTED)
    canvas.paste(image, (0, LABEL_HEIGHT))
    return canvas


def side_by_side(left, right, path, gap=20):
    height = max(left.height, right.height)
    combo = Image.new("RGB", (left.width + right.width + gap, height), BG)
    combo.paste(left, (0, 0))
    combo.paste(right, (left.width + gap, 0))
    combo.save(path)
    return combo.size


def stacked(top, bottom, path, gap=20):
    width = max(top.width, bottom.width)
    combo = Image.new("RGB", (width, top.height + bottom.height + gap), BG)
    combo.paste(top, (0, 0))
    combo.paste(bottom, (0, top.height + gap))
    combo.save(path)
    return combo.size


def main():
    # --- Техника: было / стало ---
    old_cta = load(f"{OUT}/trucks/approach-truck-full.png", (60, 250, 1920, 810))
    new_cta = load(f"{OUT}/newart/native-approach-truck-dark.png")
    size = side_by_side(
        card(old_cta, "БЫЛО: тент, колёса и кабина из простых фигур"),
        card(new_cta, "СТАЛО: фирменная техника"),
        f"{OUT}/report-vehicles-cta.png",
    )
    print(f"  report-vehicles-cta.png {size}")

    old_ltl = load(f"{OUT}/small/service-ltl.png", (0, 300, 1920, 1080))
    new_ltl = load(f"{OUT}/newart/v2-service-ltl-light.png", (0, 250, 1920, 900))
    size = side_by_side(
        card(old_ltl, "БЫЛО: миниатюра LTL — плоский серый силуэт"),
        card(new_ltl, "СТАЛО: миниатюра LTL"),
        f"{OUT}/report-vehicles-ltl.png",
    )
    print(f"  report-vehicles-ltl.png {size}")

    print("Готово. Файлы в _shots/: report-vehicles-cta.png, report-vehicles-ltl.png")


if __name__ == "__main__":
    main()
