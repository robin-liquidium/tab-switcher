#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/dist/Tab Switcher Dev.app"
MODE="${1:-run}"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# Only stop this development bundle; the installed release remains available.
pkill -f "^$APP_BUNDLE/Contents/MacOS/tab-switcher" >/dev/null 2>&1 || true
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Frameworks" "$APP_BUNDLE/Contents/Resources"
if [[ -n "${SPARKLE_FRAMEWORK_PATH:-}" ]]; then
  # Offline development can use the same pinned framework from the installed app.
  FRAMEWORK="$SPARKLE_FRAMEWORK_PATH"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$FRAMEWORK/Resources/Info.plist")" == "2.9.6" ]]
  xcrun swiftc -O -enable-upcoming-feature ExistentialAny -target "$(uname -m)-apple-macosx14.0" \
    -F "$(dirname "$FRAMEWORK")" -framework Sparkle \
    "$ROOT_DIR/native-host/Sources/tab-switcher/main.swift" \
    -o "$APP_BUNDLE/Contents/MacOS/tab-switcher"
else
  swift build -c release --package-path "$ROOT_DIR/native-host"
  BUILD_DIR="$(swift build -c release --package-path "$ROOT_DIR/native-host" --show-bin-path)"
  cp "$BUILD_DIR/tab-switcher" "$APP_BUNDLE/Contents/MacOS/tab-switcher"
  FRAMEWORK="$(find "$ROOT_DIR/native-host/.build/artifacts" -type d -name Sparkle.framework | head -1)"
fi
ditto "$FRAMEWORK" "$APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
install_name_tool -add_rpath @executable_path/../Frameworks "$APP_BUNDLE/Contents/MacOS/tab-switcher"
# Compile the same Icon Composer artwork as the release app.
xcrun actool "$ROOT_DIR/native-host/AppIcon.icon" \
  --compile "$APP_BUNDLE/Contents/Resources" \
  --output-format human-readable-text --notices --warnings --errors \
  --output-partial-info-plist "$ROOT_DIR/dist/dev-icon-partial.plist" \
  --app-icon AppIcon --include-all-app-icons --enable-on-demand-resources NO \
  --development-region en --target-device mac --minimum-deployment-target 26.0 --platform macosx
cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>tab-switcher</string>
<key>CFBundleIdentifier</key><string>build.robin.tabswitcher.dev</string>
<key>CFBundleName</key><string>Tab Switcher Dev</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleIconName</key><string>AppIcon</string>
<key>CFBundleShortVersionString</key><string>3.8.0</string>
<key>CFBundleVersion</key><string>3.8.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>LSUIElement</key><true/>
<key>TabSwitcherLocalBuild</key><true/>
</dict></plist>
PLIST
python3 - "$ROOT_DIR/release.json" "$APP_BUNDLE/Contents/Info.plist" <<'PYVERSION'
import json, plistlib, sys
metadata = json.load(open(sys.argv[1]))
with open(sys.argv[2], 'rb') as f:
    info = plistlib.load(f)
info['CFBundleShortVersionString'] = metadata['version']
info['CFBundleVersion'] = str(metadata['build'])
with open(sys.argv[2], 'wb') as f:
    plistlib.dump(info, f)
PYVERSION
codesign --force --timestamp=none --sign "${SIGNING_IDENTITY:--}" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"
# The extension can reconnect while compiling; restart again with the finished bundle.
pkill -f "^$APP_BUNDLE/Contents/MacOS/tab-switcher" >/dev/null 2>&1 || true
case "$MODE" in
  --build-only) ;;
  run) open -n "$APP_BUNDLE" ;;
  --verify) open -n "$APP_BUNDLE"; sleep 1; pgrep -f "^$APP_BUNDLE/Contents/MacOS/tab-switcher" ;;
  *) echo "usage: $0 [run|--build-only|--verify]" >&2; exit 2 ;;
esac
