# -*- coding: utf-8 -*-
"""
Сколько на самом деле весят иллюстрации и что даст переход на WebP.

Мерить «размер файла» недостаточно: SVG с viewBox 1920×1080 при показе
в полосе 1440×520 обрезается по cover. Поэтому сцена рендерится ровно так,
как её показывает сайт (background-size: cover, position: center right),
и уже этот кадр сравнивается по весу с WebP.

Запуск:
    python _tools/measure-image-weight.py
"""

import io
import os
import subprocess
import sys

from PIL import Image

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
]

# Сцена → как показывается на сайте: ширина × высота полосы, позиция фона.
CASES = [
    ("hero-truck", 1440, 520, "center right", "герой главной"),
    ("partners-fleet", 1440, 460, "center right", "герой партнёров"),
    ("about-road", 1440, 460, "center right", "герой «О компании»"),
    ("service-auto", 700, 440, "center", "миниатюра FTL"),
    ("service-ltl", 700, 440, "center", "миниатюра LTL (новая)"),
    ("approach-truck", 1440, 520, "center right", "CTA-полоса (новая)"),
]

OUT = "_shots/weight"


def chrome():
    return next((c for c in CHROME_CANDIDATES if os.path.exists(c)), None)


def shoot(svg_rel, width, height, position, target):
    """Снимает сцену так, как её показывает сайт."""
    browser = chrome()
    if not browser:
        return False

    html = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;padding:0}}
.band{{width:{width}px;height:{height}px;background-image:url('../../{svg_rel}');
background-size:cover;background-position:{position};background-repeat:no-repeat}}
</style><div class="band"></div>"""

    temp = os.path.abspath(f"_shots/weight/_probe.html")
    with open(temp, "w", encoding="utf-8") as handle:
        handle.write(html)

    target = os.path.abspath(target)
    if os.path.exists(target):
        os.remove(target)

    uri = "file:///" + temp.replace("\\", "/").replace(" ", "%20")
    subprocess.run(
        [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--force-device-scale-factor=1", f"--window-size={width},{height}",
         "--virtual-time-budget=3000", f"--screenshot={target}", uri],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    return os.path.exists(target)


def main():
    os.makedirs(os.path.abspath(OUT), exist_ok=True)
    if not chrome():
        print("Chrome не найден — замер невозможен")
        return 1

    print(f"{'сцена':<18}{'SVG':>9}{'кадр WebP q80':>15}{'экономия':>10}   где")
    total_svg = total_webp = 0

    for name, width, height, position, purpose in CASES:
        svg = f"assets/img/{name}.svg"
        if not os.path.exists(svg):
            print(f"  {name}: файла нет")
            continue

        svg_kb = os.path.getsize(svg) / 1024
        png = os.path.join(OUT, f"{name}.png")
        if not shoot(svg, width, height, position, png):
            print(f"  {name}: не удалось снять")
            continue

        image = Image.open(png).convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=80, method=6)
        webp_kb = len(buffer.getvalue()) / 1024

        total_svg += svg_kb
        total_webp += webp_kb
        savings = (1 - webp_kb / svg_kb) * 100 if svg_kb else 0
        print(f"{name:<18}{svg_kb:>7.0f} КБ{webp_kb:>13.0f} КБ{savings:>9.0f}%   {purpose}")

    if total_svg:
        print(f"\nИтого: SVG {total_svg:.0f} КБ → WebP {total_webp:.0f} КБ, "
              f"экономия {100 - total_webp / total_svg * 100:.0f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
