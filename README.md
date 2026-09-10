# Tab Switcher

**Ctrl+Tab, reimagined.** Switch between browser tabs the way you switch between apps — with visual previews and most-recently-used ordering.

[Website](https://tabswitcher.app) · [Download](https://tabswitcher.app/Tab%20Switcher.dmg) · [Setup Guide](https://tabswitcher.app/setup)

## Features

- **Visual tab previews** — See thumbnails, favicons, and titles as you cycle through tabs
- **Most recently used order** — Tabs ordered by recency, not position. One Ctrl+Tab instantly jumps to your last tab
- **Customizable shortcut** — Remap the tab switcher to any key combination
- **Native performance** — A lightweight macOS companion app intercepts shortcuts at the system level
- **Multi-browser support** — Chrome, Brave, Edge, Arc, Vivaldi, Opera, and any Chromium-based browser
- **Auto-updates** — The native app updates itself automatically via Sparkle

## How It Works

Hold **Ctrl** and press **Tab** to bring up the visual switcher. Keep holding Ctrl and press Tab repeatedly to cycle through your tabs. Release Ctrl to switch to the selected tab.

Shows recent tabs immediately. Hover a preview to select it; release Control to activate it. Press Escape to dismiss the previews without switching tabs. Cycling wraps in either direction. In the app, choose 2–10 recent tabs (default: 6). Copy URL is unassigned by default; click its shortcut field to assign it, or click × to disable it. The switch-tabs shortcut also has a × button; clearing it restores the browser’s own key handling. Settings are saved and apply to the next switch without restarting.

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
| **Alt+W** | Quick switch to last tab (no UI) |

All shortcuts can be customized in the app's setup window.

## Requirements

- macOS 14.0 or later
- Any Chromium-based browser (Chrome, Brave, Edge, Arc, Vivaldi, Opera, etc.)
- Accessibility permissions for the native app

## Privacy

Tab Switcher operates entirely locally. No data is collected, stored, or transmitted. See our [Privacy Policy](https://tabswitcher.app/privacy).

## Local development build

Run `./script/build_and_run.sh` from the repository root to build and open
`dist/Tab Switcher Dev.app`. This bundle has a separate app identity and disables
upstream update checks. The installed release is left in place.

For an offline build on this Mac using the installed, version-checked Sparkle 2.8.1 framework:

```bash
SPARKLE_FRAMEWORK_PATH='/Applications/Tab Switcher.app/Contents/Frameworks/Sparkle.framework' \
SIGNING_IDENTITY='Developer ID Application: Robin Obermaier (5S5288W3R7)' \
./script/build_and_run.sh --build-only
```

Load the repository root as an unpacked extension in Helium and disable the
Web Store copy. The local extension has its own ID; register that ID and the
development binary in Helium's `com.tabswitcher.native.json` before use.
macOS requires a separate Accessibility permission for the development app
(called Device Control and Data Access on this Mac).

Run `node --test tests/*.test.cjs` for switching and thumbnail-cache tests,
`python3 tests/native-settings.test.py` for preferences, and
`python3 tests/native-resources.test.py` for native image sizing and release checks.

Previews are resized to at most 440 pixels before caching and sending to the app.
The cache holds up to 20 previews within a 1 MiB encoded-string budget. Capture
requests are debounced and only run for an active tab in a focused browser window.
The native app releases previews and floating windows when hidden and drains
message temporaries after each message. See [resource measurements](docs/resource-usage.md).

The dev build compiles the same app icon artwork as the release. If you move the
repository, reloading an unpacked extension can change its ID; update the native
host registration to match the ID shown in the browser's extension details.

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
