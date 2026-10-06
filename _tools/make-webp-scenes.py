# -*- coding: utf-8 -*-
"""
Перевод четырёх тяжёлых сцен из SVG в WebP.

Зачем. Четыре старые сцены (`hero-truck`, `partners-fleet`, `about-road`,
`service-auto`) нарисованы контурами и весят 1110 КБ, а показываются
под затемняющей подложкой в полосе шириной до 1440 px. Вектор там избыточен:
растр в том же размере весит в разы меньше.

Почему растр в РОДНЫХ пропорциях, а не обрезанный по полосе. Сцены
показываются через `background-size: cover` в блоках разной формы
(`.hero-photo` — от 390×520 на телефоне до 1440×720 на широком экране,
`.service-thumb` — 16/10). `cover` сам решает, что обрезать, и делает это
по-разному на каждой ширине. Если запечь обрезку в картинку, на другой
ширине `cover` начнёт резать уже обрезанное — кадр уедет. Поэтому растр
рендерится в тех же пропорциях, что и viewBox источника, и ведёт себя
ровно как SVG при любой форме блока.

Запуск:
    python _tools/make-webp-scenes.py            # перерисовать WebP
    python _tools/make-webp-scenes.py --measure  # только показать вес, ничего не писать
    python _tools/make-webp-scenes.py --check    # проверить, что файлы на месте

Почему одна плотность, а не 1x + 2x. Пара «1x/2x» требует `image-set()`
в CSS. Браузеры, которые его не знают (Chrome до 113, Safari до 17), взяли бы
фолбэк — обычный `url()`, и всё было бы хорошо. Но preload картинки в <head>
выбирает файл по `imagesrcset`, а он поддерживается намного шире, чем
`image-set()`: на Chrome 73–112 preload взял бы 2x, а CSS — 1x, и браузер
скачал бы ОБА файла. Это сделало бы страницу тяжелее, чем сейчас.
Поэтому растр один, в родном размере холста (1920), а preload указывает
ровно тот же файл. Если понадобится резкость на retina — добавлять
`image-set()` вместе с правкой preload и проверкой на реальном браузере.

После правки SVG тяжёлой сцены (в том числе после `npm run scenes:light`)
WebP нужно перерисовать — это делает `npm run scenes:webp`.
"""

import io
import os
import re
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
]

# Сцена → ширина растра. Ширина равна родной ширине холста SVG (1920):
# растр получается ровно в том разрешении, в котором сцена нарисована.
SCENES = {
    "hero-truck": 1920,
    "partners-fleet": 1920,
    "about-road": 1920,
    "service-auto": 1920,
}

QUALITY = 82

# Кандидаты для замера: на какой ширине вес перестаёт падать.
MEASURE_WIDTHS = [1440, 1920, 2560]


def chrome():
    return next((c for c in CHROME_CANDIDATES if os.path.exists(c)), None)


def view_box(svg_path):
    """Размеры холста SVG — пропорции, которые нельзя терять."""
    with open(svg_path, "r", encoding="utf-8") as handle:
        head = handle.read(4000)
    match = re.search(r'viewBox="([\d.\-\s]+)"', head)
    if not match:
        raise SystemExit(f"нет viewBox: {svg_path}")
    parts = [float(v) for v in match.group(1).split()]
    return parts[2], parts[3]


def shoot(svg_path, width, height, png_path):
    """Рендерит SVG браузером ровно в нужном размере."""
    browser = chrome()
    if not browser:
        raise SystemExit("Chrome не найден — рендер SVG невозможен")

    uri = "file:///" + os.path.abspath(svg_path).replace("\\", "/").replace(" ", "%20")
    probe = os.path.join(ROOT, "_shots", "webp-probe.html")
    os.makedirs(os.path.dirname(probe), exist_ok=True)
    with open(probe, "w", encoding="utf-8") as handle:
        handle.write(
            '<!doctype html><meta charset="utf-8"><style>'
            "html,body{margin:0;padding:0;overflow:hidden}"
            f"img{{display:block;width:{width}px;height:{height}px}}"
            f'</style><img src="{uri}">'
        )

    if os.path.exists(png_path):
        os.remove(png_path)

    subprocess.run(
        [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--force-device-scale-factor=1",
         f"--window-size={width},{height}",
         "--virtual-time-budget=5000",
         # Фон страницы прозрачный: у сцен есть собственный фон, но у
         # hero-truck холст частично прозрачный — альфу надо сохранить.
         "--default-background-color=00000000",
         f"--screenshot={png_path}",
         "file:///" + probe.replace("\\", "/").replace(" ", "%20")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    return os.path.exists(png_path)


def encode(png_path, quality=QUALITY):
    image = Image.open(png_path).convert("RGBA")
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=quality, method=6, exact=True)
    return buffer.getvalue()


# Как сцены показываются: ширина × высота полосы и позиция фона.
# Для героев — полоса главной на десктопе, для миниатюры — карточка услуги.
BANDS = {
    "hero-truck": (1440, 520, "center right"),
    "partners-fleet": (1440, 460, "center right"),
    "about-road": (1440, 460, "center right"),
    "service-auto": (700, 440, "center"),
}


def shoot_band(asset_path, width, height, position, png_path):
    """Снимает ассет ровно так, как его показывает сайт (cover + позиция)."""
    browser = chrome()
    if not browser:
        raise SystemExit("Chrome не найден — проверка невозможна")

    probe = os.path.join(ROOT, "_shots", "weight", "band-probe.html")
    os.makedirs(os.path.dirname(probe), exist_ok=True)
    rel = os.path.relpath(asset_path, os.path.dirname(probe)).replace("\\", "/")
    with open(probe, "w", encoding="utf-8") as handle:
        handle.write(
            '<!doctype html><meta charset="utf-8"><style>'
            "html,body{margin:0;padding:0;overflow:hidden}"
            f".band{{width:{width}px;height:{height}px;"
            f"background-image:url('{rel}');background-size:cover;"
            f"background-position:{position};background-repeat:no-repeat}}"
            '</style><div class="band"></div>'
        )

    if os.path.exists(png_path):
        os.remove(png_path)

    subprocess.run(
        [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--force-device-scale-factor=1",
         f"--window-size={width},{height}",
         "--virtual-time-budget=5000",
         f"--screenshot={png_path}",
         "file:///" + probe.replace("\\", "/").replace(" ", "%20")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    return os.path.exists(png_path)


def verify():
    """Сверяет растр с исходным SVG в том виде, в каком сцена показывается.

    Растр с потерями, поэтому «попиксельно одинаково» быть не может.
    Смотрим на среднее расхождение и на долю сильно отличных пикселей:
    если картинка уехала или потеряла детали, эти числа сразу вырастут.
    """
    from PIL import ImageChops, ImageStat

    folder = os.path.join(ROOT, "_shots", "weight")
    os.makedirs(folder, exist_ok=True)
    print(f"{'сцена':<16}{'тема':<9}{'средн. расхождение':>19}{'пикселей >16':>15}")
    worst = 0.0

    for name, (width, height, position) in BANDS.items():
        for light in (False, True):
            svg = source(name, light)
            webp = target(name, light)
            if not os.path.exists(svg) or not os.path.exists(webp):
                print(f"{name:<16}{'—':<9}нет файлов")
                continue

            theme = "светлая" if light else "тёмная"
            slug = "light" if light else "dark"
            png_svg = os.path.join(folder, f"{name}-{slug}-svg.png")
            png_webp = os.path.join(folder, f"{name}-{slug}-webp.png")
            if not shoot_band(svg, width, height, position, png_svg):
                print(f"{name:<16}{theme:<9}не удалось снять SVG")
                continue
            if not shoot_band(webp, width, height, position, png_webp):
                print(f"{name:<16}{theme:<9}не удалось снять WebP")
                continue

            left = Image.open(png_svg).convert("RGB")
            right = Image.open(png_webp).convert("RGB")
            diff = ImageChops.difference(left, right)
            stat = ImageStat.Stat(diff)
            mean = sum(stat.mean) / 3
            histogram = diff.convert("L").histogram()
            total = sum(histogram)
            bad = sum(histogram[17:]) / total * 100
            worst = max(worst, bad)
            print(f"{name:<16}{theme:<9}{mean:>17.2f}  {bad:>13.2f}%")

    print(f"\nСнимки для глазами: _shots/weight/<сцена>-<тема>-{'{svg,webp}'}.png")
    print(f"Худший результат: {worst:.2f}% заметно отличных пикселей.")
    return 0


def target(name, light=False):
    folder = os.path.join(ROOT, "assets", "img", "light") if light else os.path.join(ROOT, "assets", "img")
    return os.path.join(folder, f"{name}.webp")


def source(name, light=False):
    folder = os.path.join(ROOT, "assets", "img", "light") if light else os.path.join(ROOT, "assets", "img")
    return os.path.join(folder, f"{name}.svg")


def measure():
    os.makedirs(os.path.join(ROOT, "_shots", "weight"), exist_ok=True)
    png = os.path.join(ROOT, "_shots", "weight", "webp-probe.png")
    print(f"{'сцена':<18}{'SVG, КБ':>10}" + "".join(f"{w:>12}" for w in MEASURE_WIDTHS))
    for name, _ in SCENES.items():
        svg = source(name)
        if not os.path.exists(svg):
            print(f"  {name}: нет файла")
            continue
        vw, vh = view_box(svg)
        svg_kb = os.path.getsize(svg) / 1024
        row = f"{name:<18}{svg_kb:>10.0f}"
        for width in MEASURE_WIDTHS:
            height = round(width * vh / vw)
            if not shoot(svg, width, height, png):
                row += f"{'—':>12}"
                continue
            row += f"{len(encode(png)) / 1024:>11.0f} К"
        print(row)
    print(f"\nСтолбцы — ширина растра. Качество {QUALITY}, WebP method=6.")


def check():
    missing = []
    for name in SCENES:
        for light in (False, True):
            if not os.path.exists(target(name, light)):
                missing.append(os.path.relpath(target(name, light), ROOT))
    if missing:
        print("НЕТ РАСТРОВ (выполните: python _tools/make-webp-scenes.py):")
        for item in missing:
            print(f"  ✖ {item}")
        return 1
    print(f"Растры сцен на месте: {len(SCENES) * 2} файлов ✅")
    return 0


def main():
    if "--measure" in sys.argv:
        measure()
        return 0
    if "--verify" in sys.argv:
        return verify()
    if "--check" in sys.argv:
        return check()

    os.makedirs(os.path.join(ROOT, "_shots", "weight"), exist_ok=True)
    png = os.path.join(ROOT, "_shots", "weight", "webp-probe.png")
    total_before = total_after = 0
    print(f"{'сцена':<16}{'тема':<9}{'SVG, КБ':>9}{'WebP, КБ':>10}{'экономия':>10}")

    for name, width in SCENES.items():
        for light in (False, True):
            svg = source(name, light)
            if not os.path.exists(svg):
                print(f"  {name}: нет {os.path.relpath(svg, ROOT)}")
                continue
            vw, vh = view_box(svg)
            height = round(width * vh / vw)
            if not shoot(svg, width, height, png):
                raise SystemExit(f"не удалось отрисовать {svg}")
            data = encode(png)
            out = target(name, light)
            with open(out, "wb") as handle:
                handle.write(data)

            svg_kb = os.path.getsize(svg) / 1024
            webp_kb = len(data) / 1024
            total_before += svg_kb
            total_after += webp_kb
            theme = "светлая" if light else "тёмная"
            print(f"{name:<16}{theme:<9}{svg_kb:>9.0f}{webp_kb:>10.0f}"
                  f"{(1 - webp_kb / svg_kb) * 100:>9.0f}%")

    print(f"\nИтого: {total_before:.0f} КБ SVG → {total_after:.0f} КБ WebP "
          f"({100 - total_after / total_before * 100:.0f}% меньше)")
    print("Дальше: node _tools/wire-scenes.mjs — подключить растры и обновить preload.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
