---
name: tab-switcher-release
description: Ship the maintained Tab Switcher fork, including reviewing current changes, updating README release notes and versions, signed universal macOS app, resumable Apple notarization, DMG, extension ZIP, GitHub release, and Sparkle verification. Use when asked to release or publish Tab Switcher changes.
---

# Tab Switcher release

Read `RELEASING.md` and inspect `release.json` and the release scripts before running them. The maintained repository is `robin-liquidium/tab-switcher`; `origin` points there and `upstream` preserves `nechemyaspitz/tab-switcher`. Never publish to upstream or update the old Chrome Web Store listing.

A request to release authorizes the release commits, push, tag, and GitHub publication. Preserve unrelated work and immutable published tags. Continue through publication and verification unless blocked by credentials, a rejected artifact, or an ambiguous external operation.

1. Inspect git status, fetch main/tags, and inspect GitHub drafts/releases/runs. Resume a pending release first. Confirm the local work to include; use an isolated checkout if unrelated work exists. Review the actual diff since the last release and run the repository's relevant checks and code review before committing.
2. Choose the next appropriate semantic version (patch by default, minor for new features), strictly increasing the integer build. Update `release.json` with today's date and concise changes grounded in the diff. Run `python3 script/prepare_release.py`; check README notes and extension version. Preserve the pinned extension public key and fork Sparkle key.
3. Build and verify the universal Developer ID app. Commit and push main, wait for CI on that commit, then tag `vVERSION` once. The release script requires a clean checkout at the exact tag. Do not change tagged sources mid-release.
4. Run the durable release path from `RELEASING.md`, using Actions if configured or local credentials otherwise. Use one submitter. Do not rebuild or resubmit pending Apple artifacts. A green workflow that leaves a draft pending is not a completed release. If Apple remains pending, establish a durable continuation with the exact tag, stage, and IDs before ending work.
5. Verify the public downloads, checksums, signatures, staples, Gatekeeper, app and extension versions, signed Sparkle feed/ZIP, and stable README URLs. Both components must be present. Explain that unpacked extensions require file replacement and Reload; do not promise Chrome Web Store automatic updates.
6. Preserve the installed app during routine releases so Robin can test Sparkle manually. Install/restart or change login items only when requested in the current task. Report the version, release link, verified distribution paths, remaining concrete user step, and any pending notarization honestly.
