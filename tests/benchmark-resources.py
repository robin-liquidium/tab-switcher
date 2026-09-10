"""Exercise a built native app with six image previews; reports actual macOS footprint.

This displays temporary switcher panels, then closes its own helper on completion.
"""
import argparse
import base64, json, struct, subprocess, time, threading
from pathlib import Path
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--image', required=True, type=Path, help='A JPEG or PNG preview fixture, ideally 3840x2160')
parser.add_argument('--cycles', type=int, default=60)
args = parser.parse_args()
app, label = str(args.app.resolve()), args.app.name
image = 'data:image/jpeg;base64,' + base64.b64encode(args.image.read_bytes()).decode()
proc = subprocess.Popen([app + '/Contents/MacOS/tab-switcher', 'chrome-extension://resource-test/'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
threading.Thread(target=lambda: proc.stdout.read(), daemon=True).start()
def send(message):
    data=json.dumps(message).encode(); proc.stdin.write(struct.pack('<I', len(data))+data); proc.stdin.flush()
def measure(stage):
    result=subprocess.run(['footprint','-p',str(proc.pid),'--noCategories'],capture_output=True,text=True)
    print(label,stage,result.stdout,flush=True)
try:
    time.sleep(2)
    measure('initial')
    for cycle in range(args.cycles):
        send({'action':'show_switcher','selectedIndex':cycle%6,'tabs':[{'id':i,'title':'Memory test '+str(i),'thumbnail':image,'favIconUrl':''} for i in range(6)]})
        time.sleep(.15)
        send({'action':'hide_switcher'})
        time.sleep(.1)
        if cycle + 1 in (args.cycles // 2, args.cycles):
            time.sleep(1)
            measure('after '+str(cycle+1)+' cycles')
    time.sleep(3)
    measure('idle')
finally:
    proc.stdin.close()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired: proc.terminate(); proc.wait(timeout=5)
