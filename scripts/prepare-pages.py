"""Stage only public runtime assets and project documentation for GitHub Pages."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'_site';OUT.mkdir(exist_ok=True)
for name in ['css','js','assets','data','docs']:
    source=ROOT/name
    if source.is_dir():shutil.copytree(source,OUT/name,dirs_exist_ok=True)
for source in [ROOT/'index.html',ROOT/'LICENSE',*ROOT.glob('*.md')]:
    if source.is_file():shutil.copy2(source,OUT/source.name)
(OUT/'.nojekyll').touch()
assert (OUT/'index.html').exists()
assert not (OUT/'node_modules').exists() and not (OUT/'artifacts').exists()
print('Public site staged in _site/')
