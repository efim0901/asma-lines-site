# -*- coding: utf-8 -*-
"""
Попиксельное сравнение двух наборов снимков страниц.

Нужно для правок CSS: снимаем все страницы в обеих темах до правки и после,
затем сравниваем. Если картинка не изменилась — удаление мёртвых правил
безопасно. Инструмент заодно годится как проверка «ничего не поехало».

Запуск:
    python _tools/compare-shots.py _shots/before _shots/after
    python _tools/compare-shots.py _shots/before _shots/after --threshold 16

Код возврата 1, если хотя бы одна пара отличается сильнее допуска.
"""

import os
import sys

from PIL import Image, ImageChops, ImageStat

DEFAULT_THRESHOLD = 16      # расхождение по каналу, которое считаем заметным
DEFAULT_TOLERANCE = 0.02    # % заметно отличных пикселей, допустимый как шум


def compare(left_path, right_path, threshold):
    left = Image.open(left_path).convert("RGB")
    right = Image.open(right_path).convert("RGB")
    if left.size != right.size:
        return None, f"размер кадра отличается: {left.size} против {right.size}"

    diff = ImageChops.difference(left, right)
    mean = sum(ImageStat.Stat(diff).mean) / 3
    histogram = diff.convert("L").histogram()
    total = sum(histogram) or 1
    bad = sum(histogram[threshold + 1:]) / total * 100
    return (mean, bad), None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2
    left_dir, right_dir = args[0], args[1]
    threshold = DEFAULT_THRESHOLD
    if "--threshold" in sys.argv:
        threshold = int(sys.argv[sys.argv.index("--threshold") + 1])

    names = sorted(f for f in os.listdir(left_dir) if f.endswith(".png"))
    if not names:
        print(f"в {left_dir} нет снимков")
        return 2

    print(f"{'снимок':<34}{'средн.':>9}{'заметных пикс.':>16}")
    failed = []
    for name in names:
        right_path = os.path.join(right_dir, name)
        if not os.path.exists(right_path):
            print(f"{name:<34}{'—':>9}нет пары в {right_dir}")
            failed.append(name)
            continue
        result, problem = compare(os.path.join(left_dir, name), right_path, threshold)
        if problem:
            print(f"{name:<34}{'—':>9}{problem}")
            failed.append(name)
            continue
        mean, bad = result
        mark = "" if bad <= DEFAULT_TOLERANCE else "  ← отличие"
        print(f"{name:<34}{mean:>9.2f}{bad:>15.3f}%{mark}")
        if bad > DEFAULT_TOLERANCE:
            failed.append(name)

    print()
    if failed:
        print(f"Отличаются: {len(failed)} — {', '.join(failed)}")
        return 1
    print("Все снимки совпадают в пределах шума ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
