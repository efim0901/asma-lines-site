# -*- coding: utf-8 -*-
"""
Нарезка длинного скриншота страницы на читаемые куски.

Нужна, чтобы рассматривать страницу целиком: один снимок 1440×7000
при просмотре сжимается и детали теряются.

Запуск:
    python _tools/slice-page.py _shots/index-light-full.png 1200
"""

import os
import sys

from PIL import Image


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    path = sys.argv[1]
    slice_height = int(sys.argv[2]) if len(sys.argv) > 2 else 1100

    image = Image.open(path)
    width, height = image.size
    base = os.path.splitext(path)[0]

    total = (height + slice_height - 1) // slice_height
    print(f"{path}: {width}×{height}, кусков по {slice_height}px — {total}")

    for index in range(total):
        top = index * slice_height
        bottom = min(top + slice_height, height)
        crop = image.crop((0, top, width, bottom))
        out = f"{base}-s{index + 1:02d}.png"
        crop.save(out)
        print(f"  {os.path.basename(out)}  строки {top}–{bottom}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
