#!/usr/bin/env python3
"""Resume a tagged release using exact artifacts and submission IDs in a GitHub draft."""
import argparse, datetime, hashlib, html, json, os, re, shutil, subprocess, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from package_app import ROOT, OUT, APP, package
REPO='robin-liquidium/tab-switcher'
BASE=f'https://github.com/{REPO}/releases'
EXTENSION_FILES=['manifest.json','mainsw.js','auto-close.js','popup.html','popup.js','icon16.png','icon32.png','icon48.png','icon128.png','LICENSE']

def call(*args, input=None):
    return subprocess.run(list(map(str,args)),cwd=ROOT,check=True,text=True,input=input,stdout=subprocess.PIPE).stdout.strip()
def github(*args): return call('gh',*args)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def upload(tag,path): github('release','upload',tag,path,'--clobber','-R',REPO)
def fetch(tag,name,checksum=None):
    github('release','download',tag,'--pattern',name,'--dir',OUT,'--clobber','-R',REPO)
    p=OUT/name
    if checksum and sha(p)!=checksum: raise ValueError(f'Artifact hash mismatch: {name}')
    return p
def lookup(tag):
    pages=json.loads(github('api','--paginate','--slurp',f'repos/{REPO}/releases?per_page=100'))
    releases=[r for page in pages for r in page]
    if any(r['draft'] and r['tag_name']!=tag for r in releases):
        raise ValueError('Another draft is pending; finish it before starting a new release')
    return next((r for r in releases if r['tag_name']==tag),None)
def save(tag,state):
    p=OUT/'release-state.json';p.write_text(json.dumps(state,indent=2)+'\n');upload(tag,p)
def notary(*args):
    if os.environ.get('NOTARY_PROFILE'):
        auth=['--keychain-profile',os.environ['NOTARY_PROFILE']]
    else:
        auth=['--key',os.environ['NOTARY_KEY_PATH'],'--key-id',os.environ['APP_STORE_CONNECT_KEY_ID'],
              '--issuer',os.environ['APP_STORE_CONNECT_ISSUER_ID']]
    return json.loads(call('xcrun','notarytool',*args,*auth,'--output-format','json'))
def submit(tag,state,kind,path):
    state.update(phase=kind+'_submitting')
    state[kind]={'file':path.name,'sha256':sha(path)}
    save(tag,state)  # An interrupted submit requires reconciliation, never a blind retry.
    result=notary('submit',path)
    state[kind]['id']=result['id'];state['phase']=kind+'_pending';save(tag,state)
def check(tag,state,kind):
    result=notary('info',state[kind]['id']);status=result['status'];print(f'{kind}: {status}',flush=True)
    if status=='In Progress': return False
    if status!='Accepted':
        state['phase']=kind+'_rejected';save(tag,state)
        raise RuntimeError(f"Apple {status}: inspect notarytool log {state[kind]['id']}")
    return True
def validate(path,kind):
    call('xcrun','stapler','staple',path);call('xcrun','stapler','validate',path)
    if kind=='app':
        call('codesign','--verify','--deep','--strict',path)
        call('spctl','--assess','--type','execute','--verbose=2',path)
    else:
        call('hdiutil','verify',path)
        call('spctl','--assess','--type','open','--context','context:primary-signature','--verbose=2',path)
def archive_app(path):
    path.unlink(missing_ok=True)
    call('ditto','-c','-k','--sequesterRsrc','--keepParent',APP,path)
def sign(path,verify=False):
    tool=next((ROOT/'native-host/.build/artifacts').rglob('bin/sign_update'))
    key=os.environ.get('SPARKLE_PRIVATE_KEY')
    auth=['--ed-key-file','-'] if key else ['--account','tab-switcher']
    return call(tool,*auth,*(['--verify'] if verify else []),path,input=key)
def extension(path):
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
        for filename in EXTENSION_FILES: archive.write(ROOT/filename,filename)
def publish_artifacts(tag,state,r):
    dmg=fetch(tag,state['dmg']['file'],state['dmg']['sha256']);validate(dmg,'dmg')
    final=OUT/f"TabSwitcher-{r['version']}.dmg";shutil.copy2(dmg,final)
    stable=OUT/'TabSwitcher.dmg';shutil.copy2(final,stable)
    appzip=fetch(tag,state['app_zip']['file'],state['app_zip']['sha256'])
    ext=OUT/'TabSwitcher-extension.zip';extension(ext)
    signature=sign(appzip)
    # sign_update returns XML attributes for update archives.
    attrs=ET.fromstring('<enclosure xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" '+signature+'/>').attrib
    ns='http://www.andymatuschak.org/xml-namespaces/sparkle';ET.register_namespace('sparkle',ns)
    rss=ET.Element('rss',version='2.0');channel=ET.SubElement(rss,'channel');ET.SubElement(channel,'title').text='Tab Switcher Robin updates'
    item=ET.SubElement(channel,'item');ET.SubElement(item,'title').text='Tab Switcher '+r['version']
    for key,value in [('version',str(r['build'])),('shortVersionString',r['version']),('minimumSystemVersion','14.0')]:
        ET.SubElement(item,'{'+ns+'}'+key).text=value
    ET.SubElement(item,'description').text='<ul>'+''.join('<li>'+html.escape(c)+'</li>' for c in r['changes'])+'</ul>'
    ET.SubElement(item,'enclosure',attrs|{'url':f'{BASE}/download/{tag}/{appzip.name}','type':'application/octet-stream'})
    feed=OUT/'appcast.xml';ET.ElementTree(rss).write(feed,encoding='utf-8',xml_declaration=True)
    sign(feed);sign(feed,verify=True)
    version=OUT/'version.json';version.write_text(json.dumps({'app':{'version':r['version'],'downloadUrl':f'{BASE}/latest/download/TabSwitcher.dmg','releaseNotes':' '.join(r['changes'])},'extension':{'version':r['version'],'chromeWebStoreUrl':f'{BASE}/latest/download/{ext.name}','releaseNotes':'Update the unpacked extension files and click Reload.'}},indent=2)+'\n')
    evidence=OUT/'notarization.json';evidence.write_text(json.dumps({'commit':state['commit'],'app':state['app'],'dmg':state['dmg'],'status':'Accepted'},indent=2)+'\n')
    files=[final,stable,appzip,ext,feed,version,evidence,ROOT/'release.json']
    sums=OUT/'SHA256SUMS';sums.write_text(''.join(f'{sha(p)}  {p.name}\n' for p in files));files.append(sums)
    for p in files: upload(tag,p)
    state['final']={p.name:sha(p) for p in files};state['phase']='ready';save(tag,state)
def advance(tag):
    if not re.fullmatch(r'v\d+\.\d+\.\d+',tag): raise ValueError('Use vMAJOR.MINOR.PATCH')
    OUT.mkdir(parents=True,exist_ok=True)
    r=json.loads((ROOT/'release.json').read_text());commit=call('git','rev-parse','HEAD')
    if tag!='v'+r['version'] or call('git','rev-list','-n','1',tag)!=commit: raise ValueError('Checkout, tag, and release version must agree')
    if call('git','status','--porcelain'): raise ValueError('Release requires a clean checkout')
    if json.loads((ROOT/'manifest.json').read_text())['version']!=r['version']: raise ValueError('Run prepare_release.py before tagging')
    call('git','fetch','origin','main');call('git','merge-base','--is-ancestor',commit,'origin/main')
    current=lookup(tag)
    if current and not current['draft']: print('Already published: '+current['html_url']);return
    if not current:
        notes=OUT/'notes.md';notes.write_text('\n'.join('- '+c for c in r['changes'])+'\n\nUniversal macOS 14+ app. Install both the app and the unpacked extension; see the repository README.\n')
        github('release','create',tag,'--verify-tag','--draft','--title','Tab Switcher '+r['version'],'--notes-file',notes,'-R',REPO)
        current=lookup(tag)
        if not current: print('Draft created; rerun after GitHub finishes indexing it.');return
    if any(a['name']=='release-state.json' for a in current['assets']):
        state=json.loads(fetch(tag,'release-state.json').read_text())
        if state['commit']!=commit or state['version']!=r['version']: raise ValueError('Draft belongs to another commit')
    else:
        state={'commit':commit,'version':r['version'],'phase':'build'};save(tag,state)
    if state['phase'].endswith(('_submitting','_rejected')): raise RuntimeError('Reconcile Apple state before continuing: '+state['phase'])
    if state['phase']=='build':
        if not os.environ.get('SIGNING_IDENTITY') or os.environ['SIGNING_IDENTITY']=='-': raise ValueError('Developer ID signing is required')
        package();path=OUT/'submission-app.zip';archive_app(path);upload(tag,path);submit(tag,state,'app',path)
    if state['phase']=='app_pending':
        if not check(tag,state,'app'): return
        source=fetch(tag,state['app']['file'],state['app']['sha256'])
        shutil.rmtree(APP,ignore_errors=True);call('ditto','-x','-k',source,OUT);validate(APP,'app')
        appzip=OUT/f"TabSwitcher-{r['version']}.zip";archive_app(appzip);upload(tag,appzip)
        state['app_zip']={'file':appzip.name,'sha256':sha(appzip)}
        staging=OUT/'dmg-stage';shutil.rmtree(staging,ignore_errors=True);staging.mkdir()
        call('ditto',APP,staging/APP.name);(staging/'Applications').symlink_to('/Applications')
        dmg=OUT/'submission-dmg.dmg';dmg.unlink(missing_ok=True)
        call('hdiutil','create','-volname','Tab Switcher Robin','-srcfolder',staging,'-format','UDZO',dmg)
        call('codesign','--timestamp','--sign',os.environ['SIGNING_IDENTITY'],dmg)
        upload(tag,dmg);submit(tag,state,'dmg',dmg)
    if state['phase']=='dmg_pending':
        if not check(tag,state,'dmg'): return
        publish_artifacts(tag,state,r)
    if state['phase']=='ready':
        # Read back every final byte before making the draft public.
        for filename,checksum in state['final'].items(): fetch(tag,filename,checksum)
        current=lookup(tag)
        for asset in current['assets']:
            if asset['name'] in ['submission-app.zip','submission-dmg.dmg']:
                github('api',f"repos/{REPO}/releases/assets/{asset['id']}",'-X','DELETE')
        github('release','edit',tag,'--draft=false','--latest','-R',REPO)
        print('Published '+BASE+'/tag/'+tag)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('tag');advance(parser.parse_args().tag)
