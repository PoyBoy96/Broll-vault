# Build from the repository root. Absolute workstation paths are not embedded here.
from pathlib import Path
root = Path(SPECPATH).parent
a = Analysis([str(root / 'desktop/main.py')],
    pathex=[str(root / 'broll_catalog_backend')],
    binaries=[], datas=[(str(root / 'web/dist'), 'web/dist')],
    hiddenimports=['webview.platforms.edgechromium'], hookspath=[], runtime_hooks=[],
    excludes=['tkinter', 'pytest', 'IPython'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='BrollVault',
    debug=False, strip=False, upx=False, console=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='BrollVault')
