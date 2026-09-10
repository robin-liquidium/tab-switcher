"""Check real image decoding and preview ownership without installing keyboard hooks."""
from pathlib import Path
import os
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1] / 'native-host/Sources/tab-switcher/main.swift').read_text()
state = source.split('// MARK: - Tab Data Model', 1)[1].split('// MARK: - Toast Notification', 1)[0]
images = source.split('func downsampleImage(', 1)[1].split('// MARK: - Browser Detection', 1)[0]
checks = r'''
let context = CGContext(data: nil, width: 3840, height: 2160, bitsPerComponent: 8,
    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(NSColor.systemBlue.cgColor)
context.fill(CGRect(x: 0, y: 0, width: 3840, height: 2160))
let jpeg = NSMutableData()
let destination = CGImageDestinationCreateWithData(jpeg, "public.jpeg" as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
assert(CGImageDestinationFinalize(destination))
let payload: [String: Any] = ["id": 1, "title": "4K preview", "thumbnail": "data:image/jpeg;base64," + (jpeg as Data).base64EncodedString()]
assert(downsampleImage(Data("invalid".utf8), maxPixelSize: 440) == nil)
assert(parseTabInfo(["title": "missing id"]) == nil)
let smallIcon = downsampleImage(jpeg as Data, maxPixelSize: 72)!
assert(smallIcon.size.width <= 72 && smallIcon.size.height <= 72)
weak var releasedImage: NSImage?
func drainMainQueue() { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
for _ in 0..<100 {
    autoreleasepool {
        let tab = parseTabInfo(payload)!
        let image = tab.thumbnail!
        assert(image.size.width == 440 && image.size.height <= 248)
        releasedImage = image
        TabSwitcherState.shared.showSwitcher(tabs: [tab], selectedIndex: 0)
        drainMainQueue()
        assert(TabSwitcherState.shared.tabs.count == 1)
        assert(TabSwitcherState.shared.isVisible)
    }
    TabSwitcherState.shared.hideSwitcher()
    drainMainQueue()
    assert(TabSwitcherState.shared.tabs.isEmpty)
    assert(!TabSwitcherState.shared.isVisible)
    assert(releasedImage == nil, "Hidden switcher retained its preview")
}
print("Native resources passed: 4K downsampling, bounded favicon, invalid data, and 100 show/hide image lifetimes")
'''
with tempfile.TemporaryDirectory(prefix='tab-switcher-resources-') as directory:
    path = Path(directory) / 'resources.swift'
    path.write_text('import Cocoa\nimport Combine\nimport ImageIO\nfunc sendMessage(_ message: [String: Any]) {}\n' + state + 'func downsampleImage(' + images + checks)
    env = dict(os.environ, DEVELOPER_DIR=os.environ.get('DEVELOPER_DIR', '/Applications/Xcode.app/Contents/Developer'))
    subprocess.run(['xcrun', 'swift', str(path)], check=True, env=env)
