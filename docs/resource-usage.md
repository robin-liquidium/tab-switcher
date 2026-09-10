# Resource measurements

Measured on Robin's Mac on September 10, 2026, using macOS `footprint`.
Resident memory (`ps` RSS) understated the original helper's usage: its footprint
was 1,289 MB, including about 1.1 GB of IOSurfaces, after normal use.

## Same-workload comparison

Two freshly launched, release-optimized native helpers received the same sequence
of 60 show/hide messages, each containing six 3840×2160 JPEG previews. Each preview
was visible for 150 ms, followed by 100 ms hidden. Measurements include brief idle
periods. Both builds received full-resolution input, so this isolates the native
fixes; browser-side resizing is an additional improvement.

| Native helper footprint | Before | After |
| --- | ---: | ---: |
| Initial | 14 MB | 9.1 MB |
| After 30 cycles | 1,835 MB | 27 MB |
| After 60 cycles, idle | 3,935 MB | 32 MB |
| Peak | 3,937 MB | 38 MB |

The final footprint was about 99.2% lower in this synthetic comparison. This is
not a claim about total browser memory or an all-day workload.

A separate 300-cycle run of the installed optimized build measured 29 MB after
60 cycles, 24 MB after 150, and 25 MB after 300 (36 MB peak). It did not show the
old linear growth. The actual browser-connected helper measured about 9 MB before
showing previews. After rendering a real browser-captured preview and hiding it,
it measured 18 MB with 0.0% CPU in an idle snapshot.

## What changed

- Drain an autorelease pool after every native message. The former endless reader
  dispatch block retained temporary Objective-C allocations for its whole lifetime.
- Decode previews with ImageIO at at most 440 pixels and favicons at 72 pixels.
- Clear tab images and release floating windows when hidden; create windows on demand.
- Resize captured screenshots in the extension before caching or transmission.
- Limit cached previews to 20 and 1,048,576 encoded characters (at most 2 MiB for
  UTF-16 string contents, excluding object/engine overhead).
- Debounce screenshot requests, serialize capture/encoding, and skip inactive,
  unfocused, minimized, and restricted tabs. Release bitmap/canvas backing storage.
- Allow timer coalescing for leader recovery and stop its timer after taking leadership.

Live Helium validation confirmed the updated extension was connected and produced
a 440×275 JPEG preview occupying 2,875 encoded characters for Example Domain.
The dev app now includes AppIcon.icns and Assets.car compiled from the release
artwork; the displayed icon was visually compared against the installed release.

Image sizing follows [Apple's ImageIO thumbnail documentation](https://developer.apple.com/documentation/imageio/kcgimagesourcecreatethumbnailfromimagealways).

## Reproduce

```bash
node --test tests/*.test.cjs
python3 tests/native-settings.test.py
python3 tests/native-resources.test.py
python3 tests/benchmark-resources.py \
  --app '/Applications/Tab Switcher Dev.app' \
  --image /absolute/path/to/3840x2160-preview.jpg --cycles 60
```

The benchmark displays temporary preview panels. It starts and stops its own
native messaging process; it does not change browser tabs or app settings.
The native regression test also checks that images are released over 100 cycles.
