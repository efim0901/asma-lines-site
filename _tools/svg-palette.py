# -*- coding: utf-8 -*-
"""
Разбор палитры SVG-иллюстраций.

Нужен, чтобы новые рисунки машин совпадали по цветам с той, что нравится
заказчику (hero-truck.svg): те же оттенки кабины, тента, дисков, тени.

Запуск:
    python _tools/svg-palette.py assets/img/hero-truck.svg
    python _tools/svg-palette.py assets/img/hero-truck.svg --top 30
"""

import re
import sys
from collections import Counter


def collect_colors(text):
    """Собирает все цвета из атрибутов fill/stroke/stop-color."""
    colors = Counter()
    # fill="#RRGGBB", stroke="#RRGGBB", stop-color="#RRGGBB"
    for match in re.finditer(r'(?:fill|stroke|stop-color)="(#[0-9A-Fa-f]{3,8})"', text):
        colors[match.group(1).upper()] += 1
    # То же, но с url(#gradient) — считаем отдельно как градиенты.
    gradients = len(re.findall(r'(?:fill|stroke)="url\(#', text))
    return colors, gradients


def hex_to_rgb(value):
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) >= 6:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    return (0, 0, 0)


def describe(hex_color):
    r, g, b = hex_to_rgb(hex_color)
    lightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    if lightness > 0.9:
        tone = "почти белый"
    elif lightness > 0.7:
        tone = "светлый"
    elif lightness > 0.45:
        tone = "средний"
    elif lightness > 0.2:
        tone = "тёмный"
    else:
        tone = "почти чёрный"
    # Красноватые оттенки бренда
    if r > g and r > b and (r - max(g, b)) > 25:
        tone += ", красный/бордо"
    elif b > r and b > g and (b - max(r, g)) > 25:
        tone += ", синий"
    elif g > r and g > b and (g - max(r, b)) > 20:
        tone += ", зелёный"
    return tone


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    path = sys.argv[1]
    top = 20
    if "--top" in sys.argv:
        top = int(sys.argv[sys.argv.index("--top") + 1])

    with open(path, encoding="utf-8") as handle:
        text = handle.read()

    colors, gradients = collect_colors(text)
    total = sum(colors.values())

    print(f"{path}")
    print(f"  всего заливок со сплошным цветом: {total}")
    print(f"  заливок градиентами: {gradients}")
    print(f"  уникальных цветов: {len(colors)}\n")

    print(f"  {'цвет':<10} {'раз':>5}  описание")
    for color, count in colors.most_common(top):
        print(f"  {color:<10} {count:>5}  {describe(color)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
