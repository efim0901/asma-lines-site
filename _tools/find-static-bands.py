# -*- coding: utf-8 -*-
"""
Поиск участков страницы, которые НЕ реагируют на смену темы.

Идея: если участок в светлой и тёмной теме выглядит одинаково, значит он
не использует переменные темы — именно такие места и создают «всегда тёмные
фоны». Скрипт сравнивает две картинки построчно и печатает найденные полосы,
а также сохраняет их вырезки, чтобы посмотреть глазами.

Запуск:
    python _tools/find-static-bands.py _shots/index-light-full.png _shots/index-dark-full.png
"""

import sys
import os

from PIL import Image, ImageChops

# Полоса считается «неадаптивной», если среднее различие по строке ниже порога.
ROW_THRESHOLD = 6.0
# Полосы короче этого значения игнорируем — это шум от сглаживания текста.
MIN_BAND_HEIGHT = 40


def row_differences(first, second):
    """Среднее абсолютное различие по каждой строке."""
    diff = ImageChops.difference(first.convert("RGB"), second.convert("RGB"))
    width, height = diff.size
    pixels = diff.load()
    rows = []
    for y in range(height):
        total = 0
        for x in range(0, width, 4):  # каждый четвёртый пиксель — достаточно и вчетверо быстрее
            r, g, b = pixels[x, y]
            total += r + g + b
        rows.append(total / ((width // 4) * 3))
    return rows


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1

    light_path, dark_path = sys.argv[1], sys.argv[2]
    light = Image.open(light_path)
    dark = Image.open(dark_path)

    if light.size != dark.size:
        print(f"Размеры не совпадают: {light.size} и {dark.size}")
        return 1

    width, height = light.size
    print(f"Сравниваю {width}×{height}")

    rows = row_differences(light, dark)

    bands = []
    start = None
    for y, value in enumerate(rows):
        static = value < ROW_THRESHOLD
        if static and start is None:
            start = y
        elif not static and start is not None:
            if y - start >= MIN_BAND_HEIGHT:
                bands.append((start, y))
            start = None
    if start is not None and height - start >= MIN_BAND_HEIGHT:
        bands.append((start, height))

    if not bands:
        print("Неадаптивных полос не найдено ✅")
        return 0

    out_dir = os.path.dirname(light_path)
    print(f"\nНайдено неадаптивных полос: {len(bands)}")
    for index, (top, bottom) in enumerate(bands, 1):
        avg = sum(rows[top:bottom]) / max(bottom - top, 1)
        print(f"  {index:>2}. строки {top:>5}–{bottom:<5} высота {bottom - top:>4}  среднее различие {avg:.1f}")

        # Сохраняем вырезку в обеих темах рядом, чтобы можно было сравнить.
        crop_light = light.crop((0, top, width, bottom))
        crop_dark = dark.crop((0, top, width, bottom))
        crop_light.save(os.path.join(out_dir, f"band-{index:02d}-light.png"))
        crop_dark.save(os.path.join(out_dir, f"band-{index:02d}-dark.png"))

    print(f"\nВырезки сохранены в {out_dir}: band-NN-light.png и band-NN-dark.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
