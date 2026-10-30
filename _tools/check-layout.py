#!/usr/bin/env python3
"""Матрица проверки вёрстки: ширины x темы x страницы.

Что проверяет: горизонтальное переполнение, битые изображения, ошибки консоли,
HTTP-ошибки ресурсов (кроме внешних), верхний контейнер. Снимает скриншоты 390 и 1440 px.
Браузер: CHROME_PATH / CHROMIUM_PATH или стандартные пути Linux.
Запуск:  python3 _tools/check-layout.py [http://localhost:8765] ; сервер: python3 -m http.server 8765
Отчёт:   reports/layout-report.json, скриншоты reports/screens/
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765').rstrip('/')
PAGES = ['index','about','services','calculator','partners','faq','contacts','privacy','404','proposal','order-doc','crm']
WIDTHS = [320,360,375,390,430,600,768,900,1024,1280,1440,1920]
SHOTS = {390,1440}
CANDS = [os.environ.get('CHROME_PATH'), os.environ.get('CHROMIUM_PATH'), '/usr/bin/chromium', '/usr/bin/chromium-browser',
         '/usr/bin/google-chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
EXE = next((c for c in CANDS if c and os.path.exists(c)), None)
JS = """()=>{const d=document.documentElement;
 const bad=[...document.images].filter(i=>i.offsetParent&&i.complete&&i.naturalWidth===0).map(i=>i.src.split('/').pop());
 const off=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed'}).slice(0,3).map(e=>e.tagName+'.'+String(e.className).slice(0,30));
 return {over:d.scrollWidth-innerWidth,bad,off,theme:d.dataset.theme||'light'}}"""
async def main():
    os.makedirs('reports/screens', exist_ok=True)
    report = {'overflow': [], 'broken_images': [], 'console': {}, 'http': {}, 'checked': 0}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--no-sandbox']) if EXE else await p.chromium.launch()
        for theme in ['light', 'dark']:
            ctx = await b.new_context(color_scheme=theme)
            await ctx.add_init_script(f"try{{localStorage.setItem('asma-theme','{theme}')}}catch(e){{}}")
            pg = await ctx.new_page()
            pg.on('console', lambda m: report['console'].setdefault(m.text[:100], 0) if m.type == 'error' else None)
            pg.on('response', lambda r: report['http'].setdefault(f'{r.status} {r.url[-60:]}', 0) if r.status >= 400 and r.url.startswith(BASE) else None)
            for name in PAGES:
                for w in WIDTHS:
                    await pg.set_viewport_size({'width': w, 'height': 800})
                    await pg.goto(f'{BASE}/{name}.html', wait_until='domcontentloaded'); await pg.wait_for_timeout(250)
                    r = await pg.evaluate(JS); report['checked'] += 1
                    if r['over'] > 1: report['overflow'].append({'theme': theme, 'page': name, 'width': w, **r})
                    if r['bad']: report['broken_images'].append({'theme': theme, 'page': name, 'width': w, 'files': r['bad']})
                    if w in SHOTS: await pg.screenshot(path=f'reports/screens/{name}-{theme}-{w}.png')
        await b.close()
    json.dump(report, open('reports/layout-report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('checked', report['checked'], '| overflow', len(report['overflow']), '| broken images', len(report['broken_images']))
    print('console errors:', list(report['console'])); print('http>=400:', list(report['http']))
    for o in report['overflow'][:12]: print(' OVER', o)
asyncio.run(main())
