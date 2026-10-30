"""Chromium product regressions. Install requirements-dev.txt and playwright chromium first."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import quote
import json, threading
from playwright.sync_api import sync_playwright, expect

APP = 'datamend-lab'
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts' / 'browser'
OUT.mkdir(parents=True, exist_ok=True)
SELECTORS={'datamend-lab':'.nav-tab[data-view]','forecastlab':'.nav-tab[data-workspace]','visualgrammar':'.nav-tab[data-view]','resamplelab':'.nav-tab-btn[data-dest]','quartetlab':None}
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT.parent)))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        errors=[]; failures=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('requestfailed',lambda r:failures.append(r.url))
        page.goto(f'http://127.0.0.1:{server.server_port}/{quote(ROOT.name)}/',wait_until='networkidle')
        nav=SELECTORS[APP]
        theme={'quartetlab':'#theme-toggle-btn','visualgrammar':'#btn-toggle-theme'}.get(APP,'#btn-theme-toggle')
        count=page.locator(nav).count() if nav else 1
        for appearance in ['light','dark']:
            for width in [320,390,768,1024,1440]:
                page.set_viewport_size({'width':width,'height':900})
                for i in range(count):
                    if nav:page.locator(nav).nth(i).click()
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(APP,width,i,appearance)
                if nav:page.locator(nav).first.click()
                if width in [390,1440]:
                    page.evaluate('scrollTo(0,0)')
                    page.screenshot(path=str(OUT/f'{appearance}-{width}.png'))
            page.locator(theme).click()
        checks.append(f'{count} workspaces fit five widths in both themes')
        page.set_viewport_size({'width':1440,'height':1000})
        file_input=None
        if APP=='datamend-lab':
            file_input='#file-upload-input'; feedback='#import-feedback'
            page.locator(file_input).set_input_files({'name':'oversized.csv','mimeType':'text/csv','buffer':b'a'*(2*1024*1024+1)})
            expect(page.locator(feedback)).to_contain_text('2 MB')
            page.locator(file_input).set_input_files({'name':'valid.csv','mimeType':'text/csv','buffer':b'id,value\n001,2\n002,3\n003,4'})
            page.locator('#btn-commit-import').click()
            expect(page.locator('#active-dataset-select')).to_contain_text('valid.csv')
            page.locator(nav).first.click()
            csv='a,b\n'+'1,2\n'*5000
            page.locator(file_input).set_input_files({'name':'boundary.csv','mimeType':'text/csv','buffer':csv.encode()})
            expect(page.locator('#btn-commit-import')).to_be_visible()
            page.locator('#imp-header').click()
            expect(page.locator(feedback)).to_contain_text('5,000')
            expect(page.locator('#imp-header')).to_be_checked()
            page.locator('#btn-cancel-import').click()
            checks.append('Oversized import rejected; valid import commits; invalid preview settings roll back')
        elif APP=='forecastlab':
            page.locator(nav).nth(1).click();file_input='#file-upload-input';feedback='#import-validation-error'
            preset=page.locator('#global-preset-select').input_value()
            for text in ['{','{"observations":[null,null,null]}','{"forecasts":[]}']:
                page.locator(file_input).set_input_files({'name':'bad.JSON','mimeType':'application/json','buffer':text.encode()})
                expect(page.locator(feedback)).not_to_be_empty()
                assert page.locator('#global-preset-select').input_value()==preset
            page.locator('#raw-csv-textarea').fill('t,y\na,1\nb,2\nc,3\nd,wrong')
            page.locator('#btn-parse-csv').click();expect(page.locator(feedback)).to_contain_text('Non-numeric')
            assert page.locator('#global-preset-select').input_value()==preset
            page.locator(file_input).set_input_files({'name':'valid.csv','mimeType':'text/csv','buffer':b't,y\n2026-01,2\n2026-02,3\n2026-03,4'})
            expect(page.locator(feedback)).to_be_empty()
            checks.append('Malformed JSON/CSV preserve active data; valid file imports')
        elif APP=='visualgrammar':
            page.locator('#btn-open-upload-modal').click();file_input='#file-input-upload';feedback='#upload-validation-msg'
            expect(page.locator('#paste-dataset-title')).to_be_focused()
            for text in ['a,a\n1,2','a,b\n1,2,3','a,b\n"open,2','{"observations":[null,{"a":2}]}']:
                page.locator('#paste-raw-textarea').fill(text)
                page.locator('#btn-confirm-import').click();expect(page.locator(feedback)).to_be_visible()
                expect(page.locator('#upload-modal-backdrop')).to_be_visible()
            page.keyboard.press('Escape');expect(page.locator('#btn-open-upload-modal')).to_be_focused()
            page.locator('#btn-open-upload-modal').click()
            page.locator('#paste-raw-textarea').fill('x,y\n1,2\n2,4\n3,5')
            page.locator('#btn-confirm-import').click();expect(page.locator('#upload-modal-backdrop')).to_be_hidden()
            page.locator('#btn-open-upload-modal').click()
            checks.append('Invalid input stays in dialog; valid data loads; Escape restores focus')
        elif APP=='resamplelab':
            page.locator(nav).nth(4).click();file_input='#wb-file-upload';feedback='#wb-validation-banner'
            for text in ['', '{}','{"sessionType":"ResampleLabSession"}']:
                page.locator('#wb-raw-input').fill(text);page.locator('#btn-wb-parse').click()
                expect(page.locator(feedback)).to_contain_text('Parse error')
            payload={'sessionType':'ResampleLabSession','designType':'one_numerical','statisticId':'mean','title':'<img src=x onerror="window.__injected=1">','dataPayload':[1,2,3,4,5]}
            page.locator('#wb-raw-input').fill(json.dumps(payload));page.locator('#btn-wb-parse').click()
            expect(page.locator(feedback)).to_contain_text('<img')
            assert page.evaluate('window.__injected === undefined')
            assert page.locator(feedback+' img').count()==0
            checks.append('Invalid sessions rejected; valid session restores; imported title stays inert text')
        elif APP=='quartetlab':
            page.locator('#open-import-btn').click();feedback='#import-validation-error'
            expect(page.locator('#import-textarea')).to_be_focused()
            page.locator('#import-textarea').fill('x,y\n1,2\n2,4\n3,6\n4,')
            page.locator('#confirm-import-btn').click();expect(page.locator(feedback)).not_to_be_empty()
            expect(page.locator('#import-modal')).to_be_visible()
            page.locator('#confirm-import-btn').focus();page.keyboard.press('Tab');expect(page.locator('#close-import-btn')).to_be_focused()
            page.keyboard.press('Escape');expect(page.locator('#open-import-btn')).to_be_focused()
            page.locator('#open-import-btn').click();page.locator('#import-textarea').fill('label,x,y\n"A, B",1,2\n"A\nB",2,4\n001,3,5')
            page.locator('#confirm-import-btn').click();expect(page.locator('#import-modal')).to_be_hidden()
            checks.append('Partial import rejected; quoted labels import; keyboard focus cycles and restores')
        if file_input:
            page.locator(file_input).set_input_files({'name':'oversized.csv','mimeType':'text/csv','buffer':b'a'*(2*1024*1024+1)})
            expect(page.locator(feedback)).to_contain_text('2 MB')
            page.evaluate('''() => {
                window.OriginalReader=window.FileReader;
                window.FileReader=class {
                    readAsText(){window.pendingReader=this;}
                    readAsArrayBuffer(){this.readAsText();}
                };
            }''')
            page.locator(file_input).set_input_files({'name':'slow.csv','mimeType':'text/csv','buffer':b'a,b\n1,2'})
            if APP=='visualgrammar':
                page.locator('#paste-raw-textarea').fill('newer draft')
            else:
                select={'datamend-lab':'#preset-loader-select','forecastlab':'#global-preset-select','resamplelab':'#wb-preset-load'}[APP]
                options=page.locator(select+' option').evaluate_all('(els)=>els.map(el=>el.value).filter(Boolean)')
                current=page.locator(select).input_value();chosen=next(o for o in options if o!=current)
                page.locator(select).select_option(chosen)
            page.evaluate('''() => {
                pendingReader.result='a,b\\n1,2';
                pendingReader.onload({target:pendingReader});
                window.FileReader=window.OriginalReader;
            }''')
            if APP=='visualgrammar':expect(page.locator('#paste-raw-textarea')).to_have_value('newer draft')
            elif APP=='datamend-lab':
                expect(page.locator('#btn-commit-import')).to_have_count(0);page.locator(nav).first.click()
            else:assert page.locator(select).input_value()==chosen
            page.evaluate('''() => { window.FileReader=class {
                readAsText(){this.onerror();} readAsArrayBuffer(){this.onerror();}
            }; }''')
            page.locator(file_input).set_input_files({'name':'unreadable.csv','mimeType':'text/csv','buffer':b'a,b\n1,2'})
            expect(page.locator(feedback)).to_contain_text('could not be read')
            checks.append('Byte limit, stale-read cancellation, and file-read recovery pass')
        assert not errors,errors
        assert not failures,failures
        browser.close()
    (OUT/'results.json').write_text(json.dumps({'app':APP,'status':'PASS','checks':checks},indent=2),encoding='utf-8')
    print(json.dumps({'app':APP,'status':'PASS','checks':checks},indent=2))
finally:server.shutdown()
