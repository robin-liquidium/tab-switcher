# Tab Switcher

**Fast Ctrl+Tab previews for Chromium browsers on macOS.** Maintained by [Robin](https://github.com/robin-liquidium), forked from [nechemyaspitz/tab-switcher](https://github.com/nechemyaspitz/tab-switcher). This repository is the source of truth for this version. The upstream project and its Chrome Web Store listing are independently maintained.

[Download macOS app](https://github.com/robin-liquidium/tab-switcher/releases/latest/download/TabSwitcher.dmg) · [Download extension](https://github.com/robin-liquidium/tab-switcher/releases/latest/download/TabSwitcher-extension.zip) · [Releases](https://github.com/robin-liquidium/tab-switcher/releases)

<!-- release:start -->
### Latest release: 3.9.0

- Optionally close inactive tabs after 1 hour to 30 days, with 24 hours selected by default.
- Keep pinned, selected, and audio-playing tabs; give existing tabs a full grace period when cleanup is enabled.
- Reopen the last 50 auto-closed tabs from the extension popup, or clear the locally stored recovery history.
- Check for expired tabs every five minutes and after browser startup, with safe handling of tab activity and extension worker restarts.
- Update both the macOS app and unpacked extension to use tab cleanup. It starts disabled.
<!-- release:end -->

## Using the switcher

Hold **Control** and press **Tab** to show recent tabs. Keep pressing Tab to cycle; **Control+Shift+Tab** goes backward. Hover a preview to select it. Release Control to switch, or press **Escape** to cancel.

In the app, choose **2–10 recent tabs** (six by default). Both directions wrap. Click a shortcut field to record a shortcut; Escape cancels recording and **×** disables it. Copy URL starts unassigned so it won't override the browser's own shortcut. The extension also provides **Alt+W** for quick switching between two tabs.

Previews are captured when tabs are visible. Reloading the extension clears its thumbnail cache; previously unopened tabs show a placeholder until visited. See [resource measurements](docs/resource-usage.md).

## Tab cleanup

In the macOS app, enable **Tab cleanup → Auto-close inactive tabs** and choose a timeout: 1, 6, 12, 24, or 48 hours, 7 days, or 30 days. It is **off by default**, with 24 hours selected. These controls require both the app and extension from version 3.9.0 or later.

The extension checks every five minutes while the browser is running, catching up after sleep or restart. Enabling or re-enabling gives existing tabs a full timeout. Viewing a tab resets its timer; background refreshes do not. Pinned tabs, the selected tab in every window, and tabs playing audio are kept. Private tabs, browser pages, and local files are excluded; only normal HTTP/HTTPS tabs are auto-closed.

Open the extension popup to **reopen the last 50 auto-closed tabs** or clear that history. The list stores titles and URLs locally in that browser profile. Reopening restores the URL, not unsaved page contents—pin tabs containing unfinished work. The extension keeps working when the macOS app is quit, using its last received settings.

Activity survives extension service-worker suspension. After a full browser restart, the extension uses the browser's restored last-accessed times; tabs without a known timestamp receive a fresh timeout. Reloading the extension does not clear recovery history.

## Installation

Requires **macOS 14 or later**, Apple silicon or Intel, and a Chromium browser such as Chrome, Helium, Brave, Edge, Arc, or Vivaldi.

1. Download the app DMG and extension ZIP from the **same release**.
2. Open the DMG and drag **Tab Switcher Robin.app** into Applications. Quit the original Tab Switcher or older dev app before opening this one.
3. Open the app and grant Accessibility permission in System Settings when prompted. Click **Enable** beside your browser.
4. Extract the extension ZIP into a permanent folder. Open your browser's extensions page (`chrome://extensions`), enable Developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Disable the original Web Store extension. The fork's fixed extension ID is `ipcmhgncockbpbfddohlgeimcjajpbgn`; no manual ID entry is needed.
6. To launch at login, add **/Applications/Tab Switcher Robin.app** under System Settings → General → Login Items. Remove the original/dev app's login entry.

Existing shortcut and browser preferences are copied once from the old app. The fork keeps its own preferences under `~/Library/Application Support/TabSwitcherRobin` and registers `build.robin.tabswitcher.native`; the original host registration is left intact.

### Updates

The native app's **Check for Updates…** uses signed Sparkle updates from this repository's GitHub releases. It cannot install an upstream release accidentally.

The unpacked extension updates **manually**: download the new ZIP, replace the files in the same permanent folder, then click **Reload** on the browser's extensions page. Always update both components when release notes require it. The manifest's public key preserves the extension ID across folder moves. This fork does not currently have a Chrome Web Store listing.

## Development and releases

Load this repository root as the unpacked extension. Run `./script/build_and_run.sh` to build and open the isolated **Tab Switcher Dev.app**. Development builds disable app update checks. Don't run the dev and installed app together: both register this fork's native host, and the last enabled app owns that registration.

Run checks:

```sh
node --test tests/*.test.cjs
python3 tests/native-settings.test.py
python3 tests/native-resources.test.py
python3 -m unittest discover -s tests -p 'test_release.py'
```

Build a universal app with `python3 script/package_app.py`. A current Xcode with Icon Composer support is required to build the icon; the packaged app still targets macOS 14+.

To ship changes, use **`$tab-switcher-release`** in Codex. It reviews the changes, updates release notes and this README, synchronizes versions, publishes a signed and notarized DMG plus extension ZIP, and verifies the update feed. Read [RELEASING.md](RELEASING.md) for credentials, commands, and interrupted-release recovery.

## Privacy and attribution

Tab history and preview images stay on your Mac. Update and browser-compatibility checks contact this repository on GitHub; no browsing history or preview content is sent. The thumbnail cache is in memory; browser and shortcut preferences are stored locally.

The MIT license and original authors' attribution are preserved in [LICENSE](LICENSE). The original extension is by Harshay Buradkar; the native app and visual switcher originate from [nechemyaspitz/tab-switcher](https://github.com/nechemyaspitz/tab-switcher). Sparkle retains its bundled license. The release process follows the approach used by Robin's Dayline and Redmi Buds Bar projects, with separate release scripts and keys for this MIT-licensed fork.
