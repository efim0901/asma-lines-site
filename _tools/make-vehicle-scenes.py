# -*- coding: utf-8 -*-
"""
Генератор иллюстраций с техникой: CTA-полосы и миниатюры услуг.

Зачем: в этих файлах машина была собрана из нескольких прямоугольников и
кружков (плоский «мультяшный» вид), а фон зашит тёмным. Здесь техника
рисуется в фирменной палитре — той же, что у большой машины в герое
(#6B1E2D, #8B2536, #1A1A1A, #F8F7EF, сталь #C3C9D1), с затенением,
дисками, фарами и полосами на тенте. Каждая сцена сразу пишется в двух
темах: тёмной и светлой.

Запуск:
    python _tools/make-vehicle-scenes.py
"""

import math
import os

OUT_DIR = "assets/img"
LIGHT_DIR = os.path.join(OUT_DIR, "light")

# ---------------------------------------------------------------------------
# Палитра
# ---------------------------------------------------------------------------

BRAND = {
    "cab": "#8B2536",
    "cab_dark": "#6B1E2D",
    "cab_deep": "#521521",
    "cab_light": "#A63047",
    "trailer": "#1A1A1A",
    "trailer_light": "#262626",
    "trailer_rib": "#303030",
    "trailer_top": "#3A3D45",
    "trailer_band": "#6B1E2D",
    "ivory": "#F8F7EF",
    "steel": "#C3C9D1",
    "steel_mid": "#8E959E",
    "steel_dark": "#4F555D",
    "chassis": "#2A2D35",
    "tire": "#131417",
    "tire_light": "#26282E",
    "glass": "#182A36",
    "glass_light": "#4A6575",
    "lamp": "#FFFDF0",
    "lamp_warm": "#FFE0A0",
    "gold": "#FFC048",
    "white_box": "#E8E2D6",
    "box": "#B07A45",
    "box_light": "#C98F55",
    "box_dark": "#8A5C31",
    "cool": "#DCE5EA",
    "cool_dark": "#A9B7C1",
}

THEMES = {
    "dark": {
        "sky_a": "#0C0709", "sky_b": "#220B14", "sky_c": "#3F121F", "sky_d": "#0E070A",
        "glow": "#8B2536", "glow_opacity": "0.5",
        "road_a": "#1E161A", "road_b": "#090607",
        "road_edge": "#8B2536",
        "mark": "#FAF8F5", "mark_opacity": "0.4",
        "gold_opacity": "0.45",
        "dots": "#E6A9B4", "dots_opacity": "0.14",
        "shadow": "#000000", "shadow_opacity": "0.85",
        "beam_opacity": "0.60",
        "trail_opacity": "0.75",
        "text": "#FAF8F5", "text_soft": "#E6A9B4",
        "panel": "#120A0D", "panel_line": "#8B2536",
    },
    "light": {
        "sky_a": "#FCFAF7", "sky_b": "#F7F2ED", "sky_c": "#F1E7E3", "sky_d": "#F8F4F0",
        "glow": "#6B1E2D", "glow_opacity": "0.10",
        "road_a": "#EFEAE3", "road_b": "#E2DAD1",
        "road_edge": "#C08A94",
        "mark": "#8D8175", "mark_opacity": "0.5",
        "gold_opacity": "0.55",
        "dots": "#8B2536", "dots_opacity": "0.07",
        "shadow": "#1A1A1A", "shadow_opacity": "0.14",
        "beam_opacity": "0.50",
        "trail_opacity": "0.35",
        "text": "#6B1E2D", "text_soft": "#8B5A64",
        "panel": "#FDFBF8", "panel_line": "#C08A94",
    },
}


# ---------------------------------------------------------------------------
# Колесо
# ---------------------------------------------------------------------------

def wheel(cx, cy, r, theme):
    """Колесо: шина, диск, шесть отверстий и ступица."""
    p = BRAND
    parts = [
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{p["tire"]}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.86:.1f}" fill="none" stroke="{p["tire_light"]}" stroke-width="{r*0.10:.1f}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.60:.1f}" fill="{p["steel_mid"]}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.60:.1f}" fill="none" stroke="{p["steel_dark"]}" stroke-width="1"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.50:.1f}" fill="{p["steel"]}"/>',
    ]
    # Отверстия в диске
    for index in range(6):
        angle = math.pi * 2 * index / 6
        hx = cx + math.cos(angle) * r * 0.40
        hy = cy + math.sin(angle) * r * 0.40
        parts.append(f'<circle cx="{hx:.1f}" cy="{hy:.1f}" r="{r*0.11:.1f}" fill="{p["steel_dark"]}"/>')
    parts += [
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.17:.1f}" fill="{p["cab_dark"]}"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.09:.1f}" fill="{p["steel"]}"/>',
    ]
    return "".join(parts)


# ---------------------------------------------------------------------------
# Тягач с полуприцепом
# ---------------------------------------------------------------------------

def semi_truck(theme):
    """
    Автопоезд в профиль, носом вправо.

    Локальные координаты: земля на y=300, тент от x=0 до x=760,
    кабина от x=770 до x=985.
    """
    p = BRAND
    t = THEMES[theme]

    parts = []

    # Тень под машиной
    parts.append(
        f'<ellipse cx="500" cy="304" rx="520" ry="22" '
        f'fill="{t["shadow"]}" opacity="{t["shadow_opacity"]}"/>'
    )

    # --- Шасси и бак ---
    parts.append(f'<rect x="30" y="238" width="940" height="16" rx="4" fill="{p["chassis"]}"/>')
    parts.append(f'<rect x="640" y="252" width="120" height="34" rx="10" fill="{p["steel_mid"]}"/>')
    parts.append(f'<rect x="646" y="256" width="108" height="10" rx="5" fill="{p["steel"]}" opacity="0.7"/>')
    parts.append(f'<rect x="60" y="252" width="150" height="34" rx="6" fill="{p["trailer_light"]}"/>')

    # --- Полуприцеп ---
    parts.append(f'<rect x="0" y="34" width="762" height="206" rx="10" fill="{p["trailer"]}"/>')
    # Верхняя рейка
    parts.append(f'<rect x="0" y="34" width="762" height="16" rx="8" fill="{p["trailer_top"]}"/>')
    parts.append(f'<rect x="0" y="44" width="762" height="4" fill="{p["steel_mid"]}" opacity="0.55"/>')
    # Вертикальные рёбра тента
    for x in range(26, 756, 58):
        parts.append(f'<rect x="{x}" y="58" width="7" height="128" rx="3" fill="{p["trailer_rib"]}"/>')
    # Бортовая полоса бордо
    parts.append(f'<rect x="0" y="186" width="762" height="54" fill="{p["trailer_band"]}"/>')
    parts.append(f'<rect x="0" y="186" width="762" height="4" fill="{p["cab_light"]}" opacity="0.35"/>')
    # Замки по низу тента
    for x in range(30, 750, 58):
        parts.append(f'<rect x="{x}" y="180" width="16" height="12" rx="3" fill="{p["steel_mid"]}"/>')
    # Логотип: корона и надпись
    parts.append(_crown(150, 108, 1.15, p["ivory"]))
    parts.append(
        f'<text x="360" y="128" fill="{p["ivory"]}" font-family="Arial Black, Arial, system-ui, sans-serif" '
        f'font-size="66" font-weight="900" letter-spacing="6">ASMA</text>'
    )
    # Задний борт и фонари
    parts.append(f'<rect x="-6" y="52" width="10" height="170" rx="4" fill="{p["trailer_light"]}"/>')
    parts.append(f'<rect x="2" y="150" width="10" height="10" rx="2" fill="#C43852"/>')

    # --- Кабина ---
    parts.append(
        f'<path d="M772 240 L772 96 L792 68 L900 68 L930 92 L978 100 '
        f'L978 240 Z" fill="{p["cab"]}"/>'
    )
    # Тень на кабине и блеск
    parts.append(f'<path d="M772 240 L772 96 L792 68 L820 68 L820 240 Z" fill="{p["cab_dark"]}" opacity="0.55"/>')
    parts.append(f'<path d="M930 92 L978 100 L978 118 L930 110 Z" fill="{p["cab_light"]}" opacity="0.5"/>')
    # Лобовое стекло с блеском
    parts.append('<path d="M880 80 L906 86 L918 118 L880 118 Z" fill="' + p["glass"] + '"/>')
    parts.append('<path d="M884 84 L892 86 L890 112 L884 112 Z" fill="' + p["glass_light"] + '" opacity="0.5"/>')
    # Боковое окно
    parts.append(f'<rect x="836" y="80" width="40" height="40" rx="4" fill="{p["glass"]}"/>')
    parts.append(f'<rect x="840" y="84" width="12" height="32" rx="3" fill="{p["glass_light"]}" opacity="0.45"/>')
    # Дверь, ручка, ступени
    parts.append(f'<path d="M824 124 L824 238" stroke="{p["cab_deep"]}" stroke-width="2"/>')
    parts.append(f'<rect x="834" y="150" width="22" height="6" rx="3" fill="{p["steel_mid"]}"/>')
    parts.append(f'<rect x="800" y="196" width="26" height="6" rx="3" fill="{p["steel_dark"]}"/>')
    parts.append(f'<rect x="800" y="216" width="26" height="6" rx="3" fill="{p["steel_dark"]}"/>')
    # Решётка и фара
    parts.append(f'<rect x="944" y="150" width="30" height="46" rx="4" fill="{p["cab_deep"]}"/>')
    parts.append(f'<rect x="950" y="156" width="18" height="6" rx="3" fill="{p["steel_dark"]}"/>')
    parts.append(f'<rect x="950" y="168" width="18" height="6" rx="3" fill="{p["steel_dark"]}"/>')
    parts.append(f'<rect x="946" y="206" width="32" height="22" rx="5" fill="{p["lamp"]}"/>')
    parts.append(f'<rect x="946" y="206" width="32" height="22" rx="5" fill="{p["lamp_warm"]}" opacity="0.5"/>')
    # Бампер
    parts.append(f'<rect x="938" y="232" width="46" height="18" rx="5" fill="{p["steel_dark"]}"/>')
    # Выхлопная труба
    parts.append(f'<rect x="760" y="52" width="10" height="150" rx="4" fill="{p["steel_mid"]}"/>')

    # --- Колёса: три оси прицепа и две оси тягача ---
    for cx in (150, 224, 298):
        parts.append(wheel(cx, 254, 46, theme))
    for cx in (856, 936):
        parts.append(wheel(cx, 254, 46, theme))

    return "".join(parts)


def _crown(cx, cy, scale, color):
    """Корона из логотипа — фирменный знак на тенте."""
    points = [
        (-38, 16), (-40, -12), (-22, 4), (-10, -22), (2, 2),
        (16, -22), (26, 4), (42, -12), (40, 16),
    ]
    path = "M " + " L ".join(f"{x},{y}" for x, y in points) + " Z"
    base = f'<rect x="-40" y="18" width="80" height="8" rx="3" fill="{color}"/>'
    return (
        f'<g transform="translate({cx}, {cy}) scale({scale})">'
        f'<path d="{path}" fill="{color}"/>'
        f'<circle cx="-40" cy="-16" r="5" fill="{color}"/>'
        f'<circle cx="-10" cy="-26" r="5" fill="{color}"/>'
        f'<circle cx="16" cy="-26" r="5" fill="{color}"/>'
        f'<circle cx="42" cy="-16" r="5" fill="{color}"/>'
        f"{base}</g>"
    )


# ---------------------------------------------------------------------------
# Одиночный грузовик (для миниатюр услуг)
# ---------------------------------------------------------------------------

def van(theme):
    """
    Малотоннажный фургон (переднеприводный «бус»): цельный кузов,
    наклонная передняя часть, два колеса. Для услуги экспресс-доставки —
    в тексте карточки речь именно о фургонах, а не о тентованных грузовиках.
    """
    p = BRAND
    t = THEMES[theme]
    parts = []

    parts.append(f'<ellipse cx="290" cy="304" rx="330" ry="18" fill="{t["shadow"]}" opacity="{t["shadow_opacity"]}"/>')

    # Кузов: высокий цельный объём с наклонной передней частью
    parts.append(
        f'<path d="M0 300 L0 96 Q0 84 12 84 L390 84 Q410 84 424 104 '
        f'L500 214 Q516 232 516 254 L516 300 Z" fill="{p["ivory"]}"/>'
    )
    # Нижняя юбка и передний бампер
    parts.append(f'<path d="M0 262 L516 262 L516 300 L0 300 Z" fill="{p["steel_mid"]}"/>')
    parts.append(f'<path d="M470 268 L516 268 L516 300 L470 300 Z" fill="{p["chassis"]}"/>')
    # Тень вдоль борта
    parts.append(f'<rect x="0" y="240" width="516" height="24" fill="{p["steel"]}" opacity="0.35"/>')
    # Лобовое стекло и боковое остекление кабины
    parts.append(f'<path d="M404 96 L446 116 L486 196 L440 196 Z" fill="{p["glass"]}"/>')
    parts.append(f'<path d="M412 102 L432 112 L438 134 L414 134 Z" fill="{p["glass_light"]}" opacity="0.5"/>')
    parts.append(f'<rect x="352" y="96" width="46" height="62" rx="5" fill="{p["glass"]}"/>')
    # Дверь и ручка
    parts.append(f'<path d="M300 96 L300 262" stroke="{p["steel_dark"]}" stroke-width="2"/>')
    parts.append(f'<rect x="312" y="150" width="26" height="7" rx="3" fill="{p["steel_dark"]}"/>')
    parts.append(f'<path d="M352 96 L352 262" stroke="{p["steel_dark"]}" stroke-width="2"/>')
    # Фирменный знак на борту
    parts.append(_crown(90, 150, 0.85, p["cab_dark"]))
    parts.append(
        f'<text x="170" y="172" fill="{p["cab_dark"]}" font-family="Arial Black, Arial, system-ui, sans-serif" '
        f'font-size="40" font-weight="900" letter-spacing="4">ASMA</text>'
    )
    # Фара и задний фонарь
    parts.append(f'<rect x="492" y="218" width="20" height="26" rx="5" fill="{p["lamp"]}"/>')
    parts.append(f'<rect x="0" y="150" width="8" height="34" rx="3" fill="#C43852"/>')

    parts.append(wheel(120, 300, 44, theme))
    parts.append(wheel(430, 300, 44, theme))
    return "".join(parts)


def box_truck(theme, kind="ltl"):
    """
    Одиночный грузовик: тент или рефрижератор.

    kind: "ltl" — тентованный, "thermo" — рефрижератор с холодильной установкой,
          "express" — малотоннажный бус.
    """
    p = BRAND
    t = THEMES[theme]
    parts = []

    if kind == "express":
        body_x, body_w, body_top, body_bottom = 0, 560, 90, 300
        cab_w = 190
    else:
        body_x, body_w, body_top, body_bottom = 0, 700, 40, 300
        cab_w = 210

    parts.append(
        f'<ellipse cx="{body_w / 2 + 120:.0f}" cy="304" rx="{body_w / 2 + 160:.0f}" ry="20" '
        f'fill="{t["shadow"]}" opacity="{t["shadow_opacity"]}"/>'
    )

    # Шасси
    parts.append(f'<rect x="20" y="288" width="{body_w + cab_w - 10}" height="14" rx="4" fill="{p["chassis"]}"/>')

    # Кузов
    body_fill = p["trailer"] if kind != "thermo" else p["cool"]
    parts.append(f'<rect x="{body_x}" y="{body_top}" width="{body_w}" height="{body_bottom - body_top}" rx="10" fill="{body_fill}"/>')

    if kind == "thermo":
        # Рефрижератор: светлый кузов, рёбра, полоса
        parts.append(f'<rect x="{body_x}" y="{body_top}" width="{body_w}" height="14" rx="7" fill="{p["cool_dark"]}"/>')
        for x in range(30, body_w - 20, 62):
            parts.append(f'<rect x="{x}" y="{body_top + 22}" width="6" height="{body_bottom - body_top - 50}" rx="3" fill="{p["cool_dark"]}" opacity="0.55"/>')
        parts.append(f'<rect x="{body_x}" y="{body_bottom - 46}" width="{body_w}" height="46" rx="0" fill="{p["cab_dark"]}"/>')
        # Подпись с температурным режимом — в верхней части кузова,
        # иначе её перекрывают колёса.
        parts.append(
            f'<text x="{body_w * 0.5:.0f}" y="{body_top + 84}" text-anchor="middle" '
            f'fill="{p["steel_dark"]}" font-family="Arial, system-ui, sans-serif" '
            f'font-size="30" font-weight="700" letter-spacing="2">−20 °C … +25 °C</text>'
        )
        parts.append(
            f'<text x="{body_w * 0.5:.0f}" y="{body_top + 132}" text-anchor="middle" '
            f'fill="{p["cab_dark"]}" font-family="Arial Black, Arial, system-ui, sans-serif" '
            f'font-size="34" font-weight="900" letter-spacing="6">ASMA</text>'
        )
        # Холодильная установка спереди
        parts.append(f'<rect x="{body_w - 10}" y="{body_top + 10}" width="46" height="70" rx="6" fill="{p["cool_dark"]}"/>')
        parts.append(f'<rect x="{body_w - 4}" y="{body_top + 18}" width="34" height="54" rx="4" fill="{p["steel_mid"]}"/>')
    else:
        # Тент: рёбра и бортовая полоса
        parts.append(f'<rect x="{body_x}" y="{body_top}" width="{body_w}" height="16" rx="8" fill="{p["trailer_top"]}"/>')
        for x in range(26, body_w - 20, 58):
            parts.append(f'<rect x="{x}" y="{body_top + 22}" width="7" height="{body_bottom - body_top - 88}" rx="3" fill="{p["trailer_rib"]}"/>')
        parts.append(f'<rect x="{body_x}" y="{body_bottom - 62}" width="{body_w}" height="62" fill="{p["trailer_band"]}"/>')
        for x in range(30, body_w - 20, 58):
            parts.append(f'<rect x="{x}" y="{body_bottom - 70}" width="16" height="12" rx="3" fill="{p["steel_mid"]}"/>')
        parts.append(_crown(body_w * 0.30, body_top + 92, 1.0, p["ivory"]))
        parts.append(
            f'<text x="{body_w * 0.46:.0f}" y="{body_top + 108}" fill="{p["ivory"]}" '
            f'font-family="Arial Black, Arial, system-ui, sans-serif" font-size="52" '
            f'font-weight="900" letter-spacing="5">ASMA</text>'
        )

    # Кабина
    cab_x = body_w + 6
    parts.append(
        f'<path d="M{cab_x} 300 L{cab_x} 110 L{cab_x + 26} 78 L{cab_x + cab_w - 40} 78 '
        f'L{cab_x + cab_w} 120 L{cab_x + cab_w} 300 Z" fill="{p["cab"]}"/>'
    )
    parts.append(f'<path d="M{cab_x} 300 L{cab_x} 110 L{cab_x + 26} 78 L{cab_x + 54} 78 L{cab_x + 54} 300 Z" fill="{p["cab_dark"]}" opacity="0.5"/>')
    parts.append(f'<path d="M{cab_x + 62} 92 L{cab_x + cab_w - 56} 92 L{cab_x + cab_w - 30} 128 L{cab_x + 62} 128 Z" fill="{p["glass"]}"/>')
    parts.append(f'<path d="M{cab_x + 68} 96 L{cab_x + 84} 96 L{cab_x + 84} 124 L{cab_x + 68} 124 Z" fill="{p["glass_light"]}" opacity="0.45"/>')
    parts.append(f'<rect x="{cab_x + cab_w - 22}" y="150" width="26" height="60" rx="4" fill="{p["cab_deep"]}"/>')
    parts.append(f'<rect x="{cab_x + cab_w - 18}" y="206" width="22" height="20" rx="4" fill="{p["lamp"]}"/>')
    parts.append(f'<rect x="{cab_x + cab_w - 24}" y="262" width="34" height="18" rx="5" fill="{p["steel_dark"]}"/>')

    # Колёса
    if kind == "express":
        for cx in (110, 470, 620):
            parts.append(wheel(cx, 300, 42, theme))
    else:
        for cx in (150, 236, 640):
            parts.append(wheel(cx, 300, 46, theme))
    return "".join(parts)


# ---------------------------------------------------------------------------
# Сцена
# ---------------------------------------------------------------------------

def scene(width, height, theme, vehicles, ground_ratio=0.56, road_edge=True):
    """Полная сцена: небо, точки, свечение, дорога, разметка и техника."""
    p = BRAND
    t = THEMES[theme]
    ground = int(height * ground_ratio)

    parts = [
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">',
        "<defs>",
        f'<linearGradient id="sky" x1="0%" y1="0%" x2="100%" y2="100%">'
        f'<stop offset="0%" stop-color="{t["sky_a"]}"/><stop offset="40%" stop-color="{t["sky_b"]}"/>'
        f'<stop offset="75%" stop-color="{t["sky_c"]}"/><stop offset="100%" stop-color="{t["sky_d"]}"/></linearGradient>',
        f'<radialGradient id="glow" cx="62%" cy="38%" r="55%">'
        f'<stop offset="0%" stop-color="{t["glow"]}" stop-opacity="{t["glow_opacity"]}"/>'
        f'<stop offset="100%" stop-color="{t["glow"]}" stop-opacity="0"/></radialGradient>',
        f'<linearGradient id="road" x1="0%" y1="0%" x2="0%" y2="100%">'
        f'<stop offset="0%" stop-color="{t["road_a"]}"/><stop offset="100%" stop-color="{t["road_b"]}"/></linearGradient>',
        f'<linearGradient id="beam" x1="0%" y1="50%" x2="100%" y2="50%">'
        f'<stop offset="0%" stop-color="{BRAND["lamp"]}" stop-opacity="0.9"/>'
        f'<stop offset="35%" stop-color="{BRAND["lamp_warm"]}" stop-opacity="0.45"/>'
        f'<stop offset="100%" stop-color="{t["glow"]}" stop-opacity="0"/></linearGradient>',
        f'<linearGradient id="trail" x1="0%" y1="0%" x2="100%" y2="0%">'
        f'<stop offset="0%" stop-color="#FF1A44" stop-opacity="0"/>'
        f'<stop offset="70%" stop-color="#FF2E50" stop-opacity="{t["trail_opacity"]}"/>'
        f'<stop offset="100%" stop-color="#FFA8B6" stop-opacity="{t["trail_opacity"]}"/></linearGradient>',
        f'<pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse">'
        f'<circle cx="18" cy="18" r="1.2" fill="{t["dots"]}" fill-opacity="{t["dots_opacity"]}"/></pattern>',
        "</defs>",
        f'<rect width="{width}" height="{height}" fill="url(#sky)"/>',
        f'<rect width="{width}" height="{height}" fill="url(#dots)"/>',
        f'<rect width="{width}" height="{height}" fill="url(#glow)"/>',
        f'<rect x="0" y="{ground}" width="{width}" height="{height - ground}" fill="url(#road)"/>',
    ]

    if road_edge:
        parts.append(f'<line x1="0" y1="{ground - 2}" x2="{width}" y2="{ground - 2}" stroke="{t["road_edge"]}" stroke-width="3" opacity="0.7"/>')

    parts.append(f'<path d="M 0 {ground + 170} L {width} {ground + 170}" stroke="{t["mark"]}" stroke-width="4" stroke-dasharray="70 45" opacity="{t["mark_opacity"]}"/>')
    parts.append(f'<line x1="0" y1="{ground + 290}" x2="{width}" y2="{ground + 290}" stroke="{p["gold"]}" stroke-width="3" opacity="{t["gold_opacity"]}"/>')
    # Световые следы скорости
    parts.append(f'<path d="M -100 {ground + 150} L 980 {ground + 150}" stroke="url(#trail)" stroke-width="7"/>')
    parts.append(f'<path d="M -50 {ground + 162} L 820 {ground + 162}" stroke="url(#trail)" stroke-width="4"/>')

    for vehicle in vehicles:
        parts.append(vehicle)

    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def place(inner, x, ground_y, scale, contact):
    """
    Ставит технику колёсами на линию дороги.

    contact — локальная координата точки касания колеса; вычитая её,
    получаем смещение так, чтобы колёса легли ровно на ground_y.
    """
    y = ground_y - contact * scale
    return f'<g transform="translate({x:.0f}, {y:.0f}) scale({scale})">{inner}</g>'


# Точка касания земли в локальных координатах каждой машины.
SEMI_CONTACT = 300      # колесо: центр 254 + радиус 46
BOX_CONTACT = {"ltl": 346, "thermo": 346, "express": 342}


def vehicle_width(kind):
    return {"semi": 990, "ltl": 916, "thermo": 916, "express": 756, "van": 516}[kind]


# ---------------------------------------------------------------------------
# Сборка файлов
# ---------------------------------------------------------------------------

def write(name, content, theme):
    directory = OUT_DIR if theme == "dark" else LIGHT_DIR
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{name}.svg")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    return f"{path} ({os.path.getsize(path) // 1024} КБ)"


def build():
    results = []

    for theme in ("dark", "light"):
        t = THEMES[theme]

        # --- CTA-полосы: 1920×800. Текст ложится слева, техника стоит справа. ---
        ground = int(800 * 0.56)          # линия дороги, как в scene()
        semi = semi_truck(theme)
        cta = scene(1920, 800, theme, [
            f'<path d="M 1440 400 L 2100 420" stroke="url(#beam)" stroke-width="22" opacity="{t["beam_opacity"]}"/>',
            place(semi, 980, ground, 0.92, SEMI_CONTACT),
        ])
        for name in ("approach-truck", "footer-about", "footer-calc", "footer-contacts",
                     "footer-faq", "footer-partners", "footer-services"):
            results.append(write(name, cta, theme))

        # --- Миниатюры услуг: 1920×1080, техника по центру кадра. ---
        thumb_ground = int(1080 * 0.62)

        def centered(kind, scale):
            width = vehicle_width(kind) * scale
            x = (1920 - width) / 2
            inner = van(theme) if kind == "van" else box_truck(theme, kind)
            contact = 344 if kind == "van" else BOX_CONTACT[kind]
            return place(inner, x, thumb_ground, scale, contact)

        results.append(write("service-ltl", scene(1920, 1080, theme, [
            centered("ltl", 1.45),
        ], ground_ratio=0.62), theme))

        results.append(write("service-express", scene(1920, 1080, theme, [
            centered("van", 2.05),
        ], ground_ratio=0.62), theme))

        results.append(write("service-thermo", scene(1920, 1080, theme, [
            centered("thermo", 1.45),
        ], ground_ratio=0.62), theme))

    return results


if __name__ == "__main__":
    print("Иллюстрации с техникой:")
    for line in build():
        print(f"  {line}")
