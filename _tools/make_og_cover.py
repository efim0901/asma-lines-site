# -*- coding: utf-8 -*-
"""
Генератор OG-обложки: assets/img/og-cover.png (1200 x 630).

Зачем: Facebook, X (Twitter) и LinkedIn не рендерят SVG, поэтому og:image
в формате .svg давал пустое превью. Скрипт перерисовывает макет
assets/img/og-cover.svg в PNG средствами Pillow (внешних зависимостей нет).

Запуск: python _tools/make_og_cover.py
Нужен шрифт с кириллицей (Segoe UI в Windows или DejaVu Sans в Linux).
"""

import os
import re

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "img", "og-cover.png")

W, H = 1200, 630

BG_FROM = (14, 23, 38)
BG_TO = (7, 12, 20)
ACCENT_FROM = (226, 62, 62)
ACCENT_TO = (255, 92, 92)
WHITE = (255, 255, 255)
MUTED = (148, 163, 184)
SOFT = (226, 232, 240)
GREEN = (34, 197, 94)

FONT_CANDIDATES = [
    (r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\segoeui.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
]


def pick_fonts():
    for bold_path, regular_path in FONT_CANDIDATES:
        if os.path.exists(bold_path) and os.path.exists(regular_path):
            return bold_path, regular_path
    raise SystemExit("Не найден шрифт с кириллицей (Segoe UI или DejaVu Sans)")


def vertical_gradient(size, start, end):
    """Диагональный градиент, как в SVG (x1,y1 -> x2,y2)."""
    width, height = size
    base = Image.new("RGB", size)
    pixels = base.load()
    for y in range(height):
        for x in range(0, width, 2):
            t = (x / width + y / height) / 2
            color = tuple(int(start[i] + (end[i] - start[i]) * t) for i in range(3))
            pixels[x, y] = color
            if x + 1 < width:
                pixels[x + 1, y] = color
    return base


def horizontal_gradient(size, start, end):
    width, height = size
    strip = Image.new("RGB", (width, 1))
    pixels = strip.load()
    for x in range(width):
        t = x / max(width - 1, 1)
        pixels[x, 0] = tuple(int(start[i] + (end[i] - start[i]) * t) for i in range(3))
    return strip.resize((width, height))


def draw_grid(image, step=40, color=(255, 255, 255, 10)):
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x in range(0, image.size[0], step):
        draw.line([(x, 0), (x, image.size[1])], fill=color, width=1)
    for y in range(0, image.size[1], step):
        draw.line([(0, y), (image.size[0], y)], fill=color, width=1)
    return Image.alpha_composite(image, overlay)


def add_glow(image, center, radius, color, alpha):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(
        [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
        fill=color + (alpha,),
    )
    return Image.alpha_composite(image, layer.filter(ImageFilter.GaussianBlur(60)))


def main():
    bold_path, regular_path = pick_fonts()

    def bold(size):
        return ImageFont.truetype(bold_path, size)

    def regular(size):
        return ImageFont.truetype(regular_path, size)

    canvas = vertical_gradient((W, H), BG_FROM, BG_TO).convert("RGBA")
    canvas = draw_grid(canvas)
    canvas = add_glow(canvas, (1050, 150), 320, ACCENT_FROM, 26)
    canvas = add_glow(canvas, (150, 500), 280, (42, 171, 238), 18)

    draw = ImageDraw.Draw(canvas)

    # --- Шапка: знак бренда, название, бейдж ---
    mark_x, mark_y, mark = 90, 80, 56
    mark_img = horizontal_gradient((mark, mark), ACCENT_FROM, ACCENT_TO).convert("RGBA")
    mask = Image.new("L", (mark, mark), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, mark - 1, mark - 1], radius=14, fill=255)
    canvas.paste(mark_img, (mark_x, mark_y), mask)

    draw = ImageDraw.Draw(canvas)
    draw.line([(mark_x + 16, mark_y + 42), (mark_x + 28, mark_y + 14)], fill=WHITE, width=5)
    draw.line([(mark_x + 28, mark_y + 14), (mark_x + 40, mark_y + 42)], fill=WHITE, width=5)
    draw.line([(mark_x + 21, mark_y + 33), (mark_x + 35, mark_y + 33)], fill=WHITE, width=5)

    brand_font = bold(32)
    draw.text((mark_x + 74, mark_y + 8), "ASMA", font=brand_font, fill=WHITE)
    asma_width = draw.textlength("ASMA ", font=brand_font)
    draw.text((mark_x + 74 + asma_width, mark_y + 8), "LINES", font=brand_font, fill=ACCENT_FROM)

    # Полупрозрачные заливки рисуем на ОТДЕЛЬНОМ слое и накладываем через
    # alpha_composite: ImageDraw по RGBA-картинке пишет цвет без альфа-смешения,
    # из-за чего плашки и бейдж получались непрозрачно-белыми.
    translucent = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(translucent)

    badge_x, badge_y, badge_w, badge_h = mark_x + 290, mark_y + 8, 252, 40
    tdraw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h],
        radius=20,
        fill=(255, 255, 255, 18),
        outline=(255, 255, 255, 44),
        width=1,
    )
    tdraw.ellipse([badge_x + 18, badge_y + 16, badge_x + 26, badge_y + 24], fill=GREEN + (255,))
    tdraw.text((badge_x + 36, badge_y + 11), "Диспетчер онлайн 24/7", font=regular(14), fill=SOFT + (255,))

    # --- Заголовок ---
    head_x, head_y = 90, 215
    head_font = bold(54)
    draw.text((head_x, head_y), "Грузоперевозки", font=head_font, fill=WHITE)
    draw.text((head_x, head_y + 68), "по всей ", font=head_font, fill=WHITE)

    prefix_width = draw.textlength("по всей ", font=head_font)
    accent_text = "Беларуси"
    accent_width = int(draw.textlength(accent_text, font=head_font)) + 6
    accent_img = horizontal_gradient((accent_width, 76), ACCENT_FROM, ACCENT_TO).convert("RGBA")
    accent_mask = Image.new("L", accent_img.size, 0)
    ImageDraw.Draw(accent_mask).text((2, 0), accent_text, font=head_font, fill=255)
    canvas.paste(accent_img, (int(head_x + prefix_width), head_y + 68), accent_mask)

    draw = ImageDraw.Draw(canvas)
    draw.text(
        (head_x, head_y + 140),
        "Организация автомобильных грузоперевозок для бизнеса:",
        font=regular(22),
        fill=MUTED,
    )
    draw.text(
        (head_x, head_y + 172),
        "тент, реф, бус и сборные грузы по всей стране.",
        font=regular(22),
        fill=MUTED,
    )

    # --- Плашки преимуществ ---
    pills = ["Подача от 2 часов", "Контроль на всём пути", "Документы и ЭТрН"]
    pill_x, pill_y, pill_h = 90, 425, 48
    pill_font = regular(17)
    for label in pills:
        pill_w = int(draw.textlength(label, font=pill_font)) + 46
        tdraw.rounded_rectangle(
            [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
            radius=12,
            fill=(255, 255, 255, 16),
            outline=(255, 255, 255, 40),
            width=1,
        )
        # Небольшой акцент вместо эмодзи: не всякий шрифт содержит пиктограммы.
        tdraw.rounded_rectangle(
            [pill_x + 14, pill_y + 21, pill_x + 18, pill_y + 29],
            radius=2,
            fill=ACCENT_FROM + (255,),
        )
        draw.text((pill_x + 30, pill_y + 15), label, font=pill_font, fill=(248, 250, 252))
        pill_x += pill_w + 16

    canvas = Image.alpha_composite(canvas, translucent)
    draw = ImageDraw.Draw(canvas)

    # --- Нижняя строка ---
    draw.line([(90, H - 96), (W - 90, H - 96)], fill=(255, 255, 255, 40), width=1)
    draw.text(
        (90, H - 72),
        "asmalines.by   ·   +375 (29) 600-00-00   ·   hello@asmalines.by",
        font=regular(18),
        fill=MUTED,
    )

    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print("Готово: {} ({} KB)".format(OUT, os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
