#!/usr/bin/env python3
"""Build a universal distributable bundle from a fresh output directory."""
import json, os, plistlib, shutil, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/release'
APP = OUT / 'Tab Switcher Robin.app'
PUBLIC_KEY = 'ZgU7wsyIwdTcqrWQjfcrOPXGOIkrd+lbBYrFMGKz9jA='

def run(*args, capture=False):
    return subprocess.run(list(map(str,args)), check=True, cwd=ROOT, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout

def package():
    metadata=json.loads((ROOT/'release.json').read_text())
    identity=os.environ.get('SIGNING_IDENTITY','-')
    build=['swift','build','--package-path','native-host','-c','release','--arch','arm64','--arch','x86_64']
    run(*build)
    binary_dir=Path(run(*build,'--show-bin-path',capture=True).strip())
    shutil.rmtree(APP,ignore_errors=True)
    for directory in ['MacOS','Resources','Frameworks']:
        (APP/'Contents'/directory).mkdir(parents=True)
    shutil.copy2(binary_dir/'tab-switcher',APP/'Contents/MacOS/tab-switcher')
    assert set(run('lipo','-archs',APP/'Contents/MacOS/tab-switcher',capture=True).split()) == {'arm64','x86_64'}
    framework=next((ROOT/'native-host/.build/artifacts').rglob('Sparkle.framework'))
    embedded=APP/'Contents/Frameworks/Sparkle.framework'
    run('ditto',framework,embedded)
    run('install_name_tool','-add_rpath','@executable_path/../Frameworks',APP/'Contents/MacOS/tab-switcher')
    run('xcrun','actool',ROOT/'native-host/AppIcon.icon','--compile',APP/'Contents/Resources',
        '--output-partial-info-plist',OUT/'icon-info.plist','--app-icon','AppIcon',
        '--include-all-app-icons','--enable-on-demand-resources','NO','--development-region','en',
        '--target-device','mac','--minimum-deployment-target','26.0','--platform','macosx')
    info={'CFBundleExecutable':'tab-switcher','CFBundleIdentifier':'build.robin.tabswitcher',
          'CFBundleName':'Tab Switcher Robin','CFBundlePackageType':'APPL','CFBundleIconFile':'AppIcon',
          'CFBundleIconName':'AppIcon','CFBundleShortVersionString':metadata['version'],
          'CFBundleVersion':str(metadata['build']),'LSMinimumSystemVersion':'14.0',
          'LSUIElement':True,'NSPrincipalClass':'NSApplication',
          'SUFeedURL':'https://github.com/robin-liquidium/tab-switcher/releases/latest/download/appcast.xml',
          'SUPublicEDKey':PUBLIC_KEY,'SUEnableAutomaticChecks':True,
          'SUVerifyUpdateBeforeExtraction':True,'SURequireSignedFeed':True}
    with (APP/'Contents/Info.plist').open('wb') as f: plistlib.dump(info,f)
    shutil.copy2(ROOT/'LICENSE',APP/'Contents/Resources/LICENSE')
    options=['--timestamp','--options','runtime'] if identity != '-' else ['--timestamp=none']
    for target in ['Versions/B/XPCServices/Downloader.xpc','Versions/B/XPCServices/Installer.xpc',
                   'Versions/B/Autoupdate','Versions/B/Updater.app','']:
        run('codesign','--force',*options,'--sign',identity,embedded/target)
    run('codesign','--force',*options,'--sign',identity,APP)
    run('codesign','--verify','--deep','--strict',APP)
    return APP
if __name__=='__main__': print(package())
