# -*- coding: utf-8 -*-
"""
Светлые версии иллюстраций: фон сцены перекрашивается, машина остаётся как есть.

Зачем: у сцен фон зашит тёмным, поэтому в светлой теме герой и миниатюры
оставались тёмными. Машину заказчик одобрил — менять её нельзя, поэтому
перекрашивается только фон.

Как определяется граница «сцена / машина»: сцена нарисована первой и снизу.
Признаки элемента сцены — он лежит внутри группы с opacity, либо без заливки,
либо залит чёрным (тени), либо залит градиентом во всю ширину холста
(небо, земля). Первый путь, который не подходит ни под один признак, —
начало машины.

Перекраска идёт по ЯРКОСТИ, а не по списку цветов: у разных файлов свои
оттенки, и таблица цветов их не покрывала. Тёмное становится светлым
в той же пропорции, светлые линии наоборот темнеют, а красноватые оттенки
получают тёплый розовый подтон вместо нейтрального серого.

Скрипт не трогает файлы, которые целиком рисует make-vehicle-scenes.py
(approach-truck, footer-*, service-ltl/express/thermo).

Запуск:
    python _tools/make-light-scenes.py
    python _tools/make-light-scenes.py hero-truck service-auto
"""

import os
import re
import sys

IMG_DIR = "assets/img"
OUT_DIR = os.path.join(IMG_DIR, "light")

# Сцены, которые перекрашиваются здесь. Остальные рисует make-vehicle-scenes.py.
SCENES = [
    "hero-truck", "service-auto", "partners-fleet",
    "about-road", "faq-road", "calc-road", "contacts-city",
]

# Светлые тона по яркости оригинала: чем темнее было, тем светлее станет.
# Нейтральные и «розовые» (для бордовых оттенков) наборы.
NEUTRAL = [(0.10, "#F7F2ED"), (0.22, "#F2EBE4"), (0.38, "#EDE4DC"), (0.55, "#E7DCD3")]
NEUTRAL_TAIL = "#DFD3C9"
ROSE = [(0.10, "#F9F4F2"), (0.22, "#F5EDEA"), (0.38, "#F0E4E1"), (0.55, "#EADBD8")]
ROSE_TAIL = "#E2D0CD"

# Штрихи: на тёмном фоне светлые линии, на светлом они должны стать тёмными.
STROKE_LIGHT = "#9C9187"
STROKE_ROSE = "#B98D96"
STROKE_DARK = "#B6ABA0"
STROKE_DARK_ROSE = "#C08A94"

GOLD = {"#FFC048": "#C9A227", "#FCBF49": "#C9A227", "#FFD382": "#A8761F"}
SHADOW_FILL = "rgba(26,26,26,0.10)"
SHADOW_STOP = "#E3DCD4"
IVORY = {"#FAF8F5", "#F8F7EF", "#FFFDF0", "#FFFFFF", "#F1ECE0"}


def parse_color(value):
    """Возвращает (r, g, b, alpha) или None."""
    value = value.strip()
    if value.lower() in ("black", "#000", "#000000"):
        return (0, 0, 0, 1.0)
    if value.lower() == "white":
        return (255, 255, 255, 1.0)
    rgb = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)", value)
    if rgb:
        alpha = float(rgb.group(4)) if rgb.group(4) else 1.0
        return (int(rgb.group(1)), int(rgb.group(2)), int(rgb.group(3)), alpha)
    hex_value = re.fullmatch(r"#([0-9A-Fa-f]{3,8})", value)
    if hex_value:
        digits = hex_value.group(1)
        if len(digits) == 3:
            digits = "".join(ch * 2 for ch in digits)
        if len(digits) == 6:
            return (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16), 1.0)
        if len(digits) == 8:
            return (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16),
                    int(digits[6:8], 16) / 255)
    return None


def is_reddish(r, g, b):
    return r > g and r > b and (r - max(g, b)) > 18


def to_light(value, role="fill", opacity=None):
    """Переводит цвет сцены в светлый аналог."""
    upper = value.upper()
    if upper in GOLD:
        return GOLD[upper]

    parsed = parse_color(value)
    if parsed is None:
        return value

    r, g, b, alpha = parsed
    if opacity is not None:
        alpha = float(opacity)
    luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    reddish = is_reddish(r, g, b)

    # Тени и почти чёрные заливки — мягкая светлая тень.
    if luminance < 0.04 or value.lower() == "black":
        return SHADOW_FILL

    if role == "stroke":
        if luminance > 0.55:
            return STROKE_ROSE if reddish else STROKE_LIGHT
        return STROKE_DARK_ROSE if reddish else STROKE_DARK

    # Светлые заливки сцены (блики, свет фар) остаются светлыми.
    if upper in IVORY and luminance > 0.9:
        return "#F3EDE7"

    table = ROSE if reddish else NEUTRAL
    for threshold, color in table:
        if luminance < threshold:
            return color
    return ROSE_TAIL if reddish else NEUTRAL_TAIL


def canvas_width(text):
    match = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', text)
    return float(match.group(1)) if match else 1920.0


def path_width(raw):
    d = re.search(r'd="([^"]*)"', raw)
    if not d:
        return None
    numbers = [float(v) for v in re.findall(r"-?\d+\.?\d*", d.group(1))]
    if len(numbers) < 4:
        return 0.0 if len(numbers) >= 2 else None
    xs = numbers[0::2]
    return max(xs) - min(xs)


def elements_of(body):
    """Пути и группы тела документа по порядку."""
    result = []
    for match in re.finditer(r"<g\b[^>]*>|</g>|<path\b[^>]*?/>", body, re.S):
        token = match.group(0)
        if token.startswith("<g"):
            result.append(("g-open", match.start(), token))
        elif token == "</g>":
            result.append(("g-close", match.start(), token))
        else:
            result.append(("path", match.start(), token))
    return result


def find_boundary(body, width):
    """Смещение начала машины внутри body или None."""
    depth = 0
    for kind, start, token in elements_of(body):
        if kind == "g-open":
            depth += 1
            continue
        if kind == "g-close":
            depth -= 1
            continue
        if depth > 0:
            continue  # внутри группы — это декор или тени сцены
        fill = re.search(r'fill="([^"]*)"', token)
        value = (fill.group(1) if fill else "").strip()
        if not value or value.lower() == "black":
            continue
        span = path_width(token)
        if span is None or span >= width * 0.72:
            continue  # градиент во всю ширину — небо или земля
        return start
    return None


def recolour_attributes(chunk, role_map):
    """Перекрашивает fill/stroke/stop-color в куске документа."""
    def swap(match):
        attribute, value = match.group(1), match.group(2)
        role = role_map.get(attribute, "fill")
        return f'{attribute}="{to_light(value, role)}"'
    return re.sub(r'\b(fill|stroke|stop-color)="([^"]+)"', swap, chunk)


def process(name):
    source = os.path.join(IMG_DIR, f"{name}.svg")
    if not os.path.exists(source):
        return f"  {name}: файла нет — пропуск"

    with open(source, encoding="utf-8") as handle:
        text = handle.read()

    width = canvas_width(text)

    group = re.search(r'<g[^>]*clip-path="[^"]*"[^>]*>', text)
    if group:
        body_start = group.end()
        body_end = text.rindex("</g>")
    else:
        defs_end = text.find("</defs>")
        if defs_end == -1:
            return f"  {name}: не найдено тело документа — пропуск"
        body_start = defs_end + len("</defs>")
        body_end = text.rindex("</svg>")

    body = text[body_start:body_end]
    boundary = find_boundary(body, width)

    # Если машины в сцене нет (город, дорога, обочина), граница не находится —
    # тогда перекрашивается вся иллюстрация целиком.
    if boundary is None:
        scene = body
        subject = ""
        whole_scene = True
    else:
        scene = body[:boundary]
        subject = body[boundary:]
        whole_scene = False

    # Какие градиенты использует сцена — только их и перекрашиваем.
    scene_gradients = set(re.findall(r"url\(#([^)]+)\)", scene))

    scene_new = recolour_attributes(scene, {"stroke": "stroke"})

    result = text[:body_start] + scene_new + subject + text[body_end:]

    def repaint_gradient(match):
        if match.group(2) not in scene_gradients:
            return match.group(0)
        return recolour_attributes(match.group(0), {})

    result = re.sub(
        r'<(linearGradient|radialGradient)\b[^>]*id="([^"]+)"[^>]*>.*?</\1>',
        repaint_gradient,
        result,
        flags=re.S,
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{name}.svg")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(result)

    changed_gradients = len(scene_gradients)
    kind = "вся иллюстрация (машины нет)" if whole_scene else "только фон, машина не тронута"
    return (f"  {name}: {kind}; символов перекрашено {len(scene)}, "
            f"градиентов сцены: {changed_gradients}")


def main():
    names = sys.argv[1:] or SCENES
    print("Светлые версии сцен (фон перекрашивается, машина не меняется):")
    for name in names:
        print(process(name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
