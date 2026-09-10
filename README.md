# Tab Switcher

**Ctrl+Tab, reimagined.** Switch between browser tabs the way you switch between apps — with visual previews and most-recently-used ordering.

[Website](https://tabswitcher.app) · [Download](https://tabswitcher.app/Tab%20Switcher.dmg) · [Setup Guide](https://tabswitcher.app/setup)

## Features

- **Visual tab previews** — See thumbnails, favicons, and titles as you cycle through tabs
- **Most recently used order** — Tabs ordered by recency, not position. One Ctrl+Tab instantly jumps to your last tab
- **Optional shortcuts** — Remap or disable the tab-switch and copy-URL shortcuts
- **Adjustable preview count** — Choose 2–10 recent tabs (default: 6), with wraparound cycling
- **Native performance** — A lightweight macOS companion app intercepts shortcuts at the system level
- **Multi-browser support** — Chrome, Brave, Edge, Arc, Vivaldi, Opera, and any Chromium-based browser
- **Auto-updates** — The native app updates itself automatically via Sparkle

## How It Works

Hold **Ctrl** and press **Tab** to bring up the visual switcher. Keep holding Ctrl and press Tab repeatedly to cycle through your tabs. Release Ctrl to switch to the selected tab.

The switcher appears immediately. Hover a preview to select it, or press **Escape** to cancel without changing tabs. Cycling wraps in either direction.

Choose the maximum number of recent tabs in the app (2–10, default: 6). Changes apply to the next switch.

Copy URL is unassigned by default. Click either shortcut field to record a shortcut, press Escape to cancel recording, or click × to clear it. Clearing the tab-switch shortcut restores the browser's own key handling. Existing saved shortcuts are preserved.

Works exactly like macOS app switching (Cmd+Tab), but for your browser tabs.

## Installation

Tab Switcher requires two components: a browser extension and a native macOS app.

### 1. Install the Extension

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select this folder
5. Note the **Extension ID** shown (you'll need this later)

### 2. Install the Native App

Download the macOS app from [tabswitcher.app](https://tabswitcher.app/Tab%20Switcher.dmg).

1. Open the DMG and drag Tab Switcher to Applications
2. Open Tab Switcher from Applications
3. Grant Accessibility permission when prompted
4. Click **Enable** for your browser
5. Enter the **Extension ID** from step 1.5 and click **Save**

### 3. Grant Accessibility Permissions

If not prompted automatically:

1. Open **System Settings > Privacy & Security > Accessibility**
2. Enable the toggle next to Tab Switcher

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Tab** | Open switcher, cycle forward |
| **Ctrl+Shift+Tab** | Cycle backward |
| **Escape** | Cancel an open switcher or shortcut recording |
| **Copy URL** (unassigned by default) | Assign a shortcut in the app to copy the current URL |
| **Alt+W** | Quick switch to last tab (no UI) |

The tab-switch and copy-URL shortcuts can be customized in the app's setup window.

Hover selection, cancellation, and the preview-count setting require both the updated app and extension. Reload an unpacked extension after changing its files; restarting the companion app alone does not load new extension code.

## Requirements

- macOS 14.0 or later
- Any Chromium-based browser (Chrome, Brave, Edge, Arc, Vivaldi, Opera, etc.)
- Accessibility permissions for the native app

## Privacy

Tab Switcher operates entirely locally. No data is collected, stored, or transmitted. See our [Privacy Policy](https://tabswitcher.app/privacy).

## Building from Source

### Extension
The extension files are in the root directory. Load unpacked in Chrome.

### Native App
```bash
cd native-host
swift build -c release
```

The built binary will be at `native-host/.build/release/tab-switcher`. To create a full app bundle with the Sparkle framework embedded:

```bash
cd native-host
./build.sh
```

The app bundle will be at `dist/Tab Switcher.app`. Code signing and notarization require a valid Apple Developer ID certificate and are optional for local development:

```bash
./build.sh --sign              # build + code sign
./build.sh --sign --notarize   # build + sign + notarize
```

## Background resource usage

Previews are resized to at most 440 pixels before caching and sending to the app.
The cache holds up to 20 previews within a 1 MiB encoded-string budget. Capture
requests are debounced and only run for an active tab in a focused browser window.
The native app releases previews and floating windows when hidden and drains
message temporaries after each message. See [measurements and the reproducible benchmark](docs/resource-usage.md).

## Tests

Run the extension behavior tests with Node.js and the native settings tests with Python 3 and the macOS Swift toolchain:

```bash
node --test tests/*.test.cjs
python3 tests/native-settings.test.py
python3 tests/native-resources.test.py
```

## Project Structure

```
├── manifest.json          # Chrome extension manifest
├── mainsw.js              # Extension service worker
├── popup.html/js          # Extension popup UI
├── icon*.png              # Extension icons
├── native-host/
│   ├── Package.swift      # Swift package definition
│   ├── Sources/
│   │   └── tab-switcher/
│   │       └── main.swift # Native macOS app
│   ├── build.sh           # Build + sign + notarize script
│   ├── install.sh         # Install native messaging host
│   └── uninstall.sh       # Uninstall native messaging host
└── docs/                  # Website (GitHub Pages)
    ├── index.html
    ├── setup.html
    └── privacy.html
```

## Troubleshooting

**Extension shows "Not connected":**
- Make sure the Tab Switcher app is running
- Check that you've granted Accessibility permissions
- Verify the Extension ID was entered correctly

**Ctrl+Tab doesn't work:**
- Verify Accessibility permissions are enabled
- Make sure the browser window is focused

For more help, visit the [Setup Guide](https://tabswitcher.app/setup).

## License

MIT License — see [LICENSE](LICENSE)
