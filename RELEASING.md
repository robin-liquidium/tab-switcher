# Releasing Tab Switcher

Use `$tab-switcher-release` from this repository. `release.json` is the version/build/date/notes source of truth. `python3 script/prepare_release.py` synchronizes the extension version and the README's latest-release section. The packaged app reads the same metadata. Every release ships the app and extension together.

## Credentials

Local releases need `gh` authenticated to `robin-liquidium`, Xcode, and a Developer ID certificate. Set `SIGNING_IDENTITY` to the certificate name and either `NOTARY_PROFILE` to an existing notarytool Keychain profile or `NOTARY_KEY_PATH`, `APP_STORE_CONNECT_KEY_ID`, and `APP_STORE_CONNECT_ISSUER_ID` for an App Store Connect API key.

Sparkle's private key is in the login Keychain under service `https://sparkle-project.org`, account **tab-switcher**. Its public key is in `script/package_app.py`. Preserve this key; do not rotate it casually or use Dayline/Redmi keys. CI uses `SPARKLE_PRIVATE_KEY` through standard input, never a command-line argument.

The `Release` Actions workflow needs six repository secrets: `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APP_STORE_CONNECT_KEY_P8_BASE64`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and `SPARKLE_PRIVATE_KEY`. Configure these from the original local credential sources; GitHub cannot export existing repository secrets. Never commit credentials. Choose **one submitter** per release: Actions when configured, otherwise the local command. Do not run both concurrently.

## Release

1. Inspect current changes, remote main, tags, public releases and drafts. Resume any pending draft before choosing a new version. Review actual changes and write user-facing notes in `release.json`; increment semantic version and integer build beyond all previous public/draft builds. Run `python3 script/prepare_release.py`.
2. Run the README checks, review code changes, and build the signed universal app using `SIGNING_IDENTITY='Developer ID Application: …' python3 script/package_app.py`. Verify both architectures, signature, version, build, and fork update identity. Do not install during routine release validation.
3. Commit and push main, wait for CI on that exact commit, then create and push **one immutable tag** `vVERSION`. Tag, metadata, and checkout must agree.
4. With CI secrets configured, enable Actions on the fork and let `Release` run. Otherwise use `python3 script/release.py vVERSION` locally with the credentials above. Repeat the same command to advance the existing draft; it restores exact saved artifacts rather than rebuilding pending submissions.
5. `release-state.json` in the GitHub draft stores the commit, stage, hashes and Apple submission IDs. The workflow resumes every 20 minutes. After both app and DMG acceptance, it staples them, checks Gatekeeper, signs the update ZIP and feed, reads back final asset hashes, removes temporary submission archives, and publishes.
6. Download the public `SHA256SUMS` and assets into a temporary directory and verify the hashes, app/DMG staples, Gatekeeper, both architectures, versions, and extension contents. Verify the feed using Sparkle's `sign_update --account tab-switcher --verify appcast.xml` and verify the ZIP with its enclosure signature. The stable latest-release URLs in the README and app must resolve to these files. A signed feed is not proof of a completed end-user Sparkle upgrade.

The release contains `TabSwitcher-VERSION.dmg`, `TabSwitcher.dmg`, `TabSwitcher-VERSION.zip`, `TabSwitcher-extension.zip`, `appcast.xml`, `version.json`, `release.json`, `notarization.json`, `release-state.json`, and `SHA256SUMS`. GitHub's latest release hosts the update feed directly; no website deploy or Homebrew tap is required.

## Pending or interrupted notarization

`app_pending` and `dmg_pending` mean Apple is reviewing a saved artifact. Continue the same draft. Never resubmit just because Apple is slow. If running locally, arrange a Codex follow-up that invokes the same command with the same credentials and stops after publication; do not leave a terminal waiting for hours.

`*_submitting` means the submission result may have been lost. Inspect Apple history, reconcile name/time against the saved artifact, recover its ID, set the matching `app.id` or `dmg.id`, and change phase to `*_pending`. Upload the reconciled state to the same draft. Do not submit again unless Apple history establishes that no request exists. An ambiguous result is a stopping condition, not a reason to retry blindly.

`*_rejected` requires reading `notarytool log ID` and fixing the stated problem. A source change needs a new version/build and tag. Never move a published tag. For GitHub indexing delays, rerun after the draft is visible. Finish one release before starting the next.

## Local installation

Routine releases preserve the installed app so Robin can test Sparkle. On an explicitly requested first installation, install the verified **Tab Switcher Robin.app**, quit the old dev/original instances, and replace the login item with the new Applications path. Browser extension Reload and Accessibility approval may require Robin. Keep the old app as a rollback until the new pairing works.
