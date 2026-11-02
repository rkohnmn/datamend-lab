"""Automated WCAG A/AA checks; not a replacement for assistive-technology testing."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json, threading, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
APP=ROOT.name
OUT=ROOT/'artifacts/accessibility';OUT.mkdir(parents=True,exist_ok=True)
NAV={'datamend-lab':'.nav-tab[data-view]','forecastlab':'.nav-tab[data-workspace]','visualgrammar':'.nav-tab[data-view]','resamplelab':'.nav-tab-btn[data-dest]'}
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'dist' if APP=='datasense-studio' else ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        page.goto(f'http://127.0.0.1:{server.server_port}',wait_until='networkidle')
        page.add_style_tag(content='*, *::before, *::after {transition:none !important; animation:none !important;}')
        page.add_script_tag(path=str(ROOT/'node_modules/axe-core/axe.min.js'))
        routes=['home','apps','compass','workflows','finder','learn','methods','about'] if APP=='datasense-studio' else list(range(page.locator(NAV[APP]).count())) if APP in NAV else [0]
        for width in [1440,320]:
            page.set_viewport_size({'width':width,'height':1000})
            for theme in ['light','dark']:
                page.evaluate('t=>document.documentElement.dataset.theme=t',theme)
                for route in routes:
                    if APP=='datasense-studio':page.evaluate('r=>navigateTo(r)',route)
                    elif APP in NAV:page.locator(NAV[APP]).nth(route).click()
                    result=page.evaluate("async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})")
                    results.append({'route':str(route)+'-'+theme+'-'+str(width),'violations':[{k:v[k] for k in ['id','impact','description','helpUrl','nodes']} for v in result['violations']]})
        page.set_viewport_size({'width':320,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Reflow failed at 320 CSS pixels'
        page.keyboard.press('Tab')
        assert page.evaluate("document.activeElement !== document.body"),'Keyboard focus does not enter interactive content'
        page.screenshot(path=str(OUT/'reflow-320.png'))
        browser.close()
    (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    issues=[(r['route'],v['id'],len(v['nodes'])) for r in results for v in r['violations']]
    print(json.dumps({'app':APP,'violations':issues}))
    assert not issues, 'Accessibility violations: see artifacts/accessibility/results.json'
finally:server.shutdown()
