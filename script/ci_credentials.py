#!/usr/bin/env python3
"""Load repository secrets into an ephemeral Actions signing keychain."""
import base64,os,secrets,subprocess
from pathlib import Path
required=['MACOS_CERTIFICATE_P12_BASE64','MACOS_CERTIFICATE_PASSWORD','APP_STORE_CONNECT_KEY_P8_BASE64','APP_STORE_CONNECT_KEY_ID','APP_STORE_CONNECT_ISSUER_ID','SPARKLE_PRIVATE_KEY']
for key in required:
    if not os.environ.get(key): raise SystemExit('Missing Actions secret: '+key)
os.umask(0o077)
temp=Path(os.environ['RUNNER_TEMP']);p12=temp/'tab-switcher.p12';p8=temp/'tab-switcher.p8'
p12.write_bytes(base64.b64decode(os.environ[required[0]]));p8.write_bytes(base64.b64decode(os.environ[required[2]]))
keychain=temp/'tab-switcher-signing.keychain-db';password=secrets.token_hex(24)
def security(*args):
    result=subprocess.run(['security',*map(str,args)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if result.returncode: raise SystemExit('Keychain setup failed at '+str(args[0]))
security('create-keychain','-p',password,keychain)
security('set-keychain-settings','-lut','21600',keychain)
security('unlock-keychain','-p',password,keychain)
security('import',p12,'-k',keychain,'-P',os.environ['MACOS_CERTIFICATE_PASSWORD'],'-T','/usr/bin/codesign','-T','/usr/bin/security')
security('set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',password,keychain)
security('list-keychains','-d','user','-s',keychain,Path.home()/'Library/Keychains/login.keychain-db')
with open(os.environ['GITHUB_ENV'],'a') as f: f.write('NOTARY_KEY_PATH='+str(p8)+'\n')
