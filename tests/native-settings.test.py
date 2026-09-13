"""Exercise the app's actual preference types without starting its keyboard hook."""
from pathlib import Path
import os
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1] / 'native-host/Sources/tab-switcher/main.swift').read_text()
settings = source.split('// MARK: - Keyboard Shortcut Configuration', 1)[1].split('// MARK: - Browser Configuration', 1)[0]
checks = r'''
func roundTrip(_ settings: ShortcutsConfiguration) throws -> ShortcutsConfiguration {
    try JSONDecoder().decode(ShortcutsConfiguration.self, from: JSONEncoder().encode(settings))
}
var config = ShortcutsConfiguration.defaults
assert(config.tabSwitch != nil && config.copyUrl == nil && config.maxRecentTabs == 6)
assert(!config.autoClose.enabled && config.autoClose.hours == 24)
config.autoClose.enabled = true
config.autoClose.hours = 168
config.copyUrl = ShortcutConfig(keyCode: Int64(kVK_ANSI_C), modifiers: CGEventFlags([.maskCommand, .maskShift]).rawValue)
config.maxRecentTabs = 8
var restored = try roundTrip(config)
assert(restored.copyUrl == config.copyUrl && restored.maxRecentTabs == 8)
assert(restored.autoClose.enabled && restored.autoClose.hours == 168)
assert(restored.autoClose.message["enabled"] as? Bool == true)
assert(restored.autoClose.message["hours"] as? Int == 168)
config.tabSwitch = nil
config.copyUrl = nil
restored = try roundTrip(config)
assert(restored.tabSwitch == nil && restored.copyUrl == nil)
updateShortcutGlobals(from: restored)
assert(tabSwitchKeyCode == -1 && tabSwitchModifiers == 0 && copyUrlShortcut == nil)
let legacy = Data(#"{"tabSwitch":{"keyCode":48,"modifiers":262144},"copyUrl":{"keyCode":8,"modifiers":1179648}}"#.utf8)
restored = try JSONDecoder().decode(ShortcutsConfiguration.self, from: legacy)
assert(restored.tabSwitch?.keyCode == 48 && restored.copyUrl?.keyCode == 8 && restored.maxRecentTabs == 6)
assert(!restored.autoClose.enabled && restored.autoClose.hours == 24)
let invalidTimeout = Data(#"{"autoClose":{"enabled":true,"hours":0}}"#.utf8)
restored = try JSONDecoder().decode(ShortcutsConfiguration.self, from: invalidTimeout)
assert(restored.autoClose.enabled && restored.autoClose.hours == 24)
updateShortcutGlobals(from: .defaults)
assert(tabSwitchKeyCode == Int64(kVK_Tab) && copyUrlShortcut == nil)
print("Settings passed: defaults, assigned shortcuts, clearing both shortcuts, persistence, legacy decoding, and reset")
'''
with tempfile.TemporaryDirectory(prefix='tab-switcher-settings-') as temporary:
    swift_file = Path(temporary) / 'settings.swift'
    swift_file.write_text('import Cocoa\nimport Carbon\n' + settings + checks)
    env = dict(os.environ, DEVELOPER_DIR=os.environ.get('DEVELOPER_DIR', '/Applications/Xcode.app/Contents/Developer'))
    subprocess.run(['xcrun', 'swift', str(swift_file)], check=True, env=env)
