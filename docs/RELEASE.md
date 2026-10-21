# PlasmidCraft 0.34 release guide

Release version: **0.34.0**. Display name: **PlasmidCraft 0.34**. Application identifier: `org.plasmidcraft.desktop`. Native DNA documents use format version 3; protein documents use format version 1. Keep `.pcraft` as the full editable document.

## Test installers

This package is a test release. There is no Developer ID or Windows publisher signing identity configured. Mac apps carry ad-hoc signatures to protect bundle integrity, but they are not notarized. Windows executables are unsigned. Checksums identify the supplied files; they do not establish a trusted publisher.

For Mac testing, open the matching DMG, drag the app to Applications, then launch it. If macOS blocks an app you have independently verified, use the app-specific **Open Anyway** control in System Settings → Privacy & Security. Do not disable Gatekeeper globally. On Windows, verify the source and hash before making any app-specific SmartScreen decision. Organizations may prohibit unsigned applications.

The Mac build declares macOS 12.3 as its minimum; this release was built on macOS 15.7.9 with Xcode 26.3. Older OS compatibility and target-device acceptance need testing. Windows targets x64 MSVC and requires Windows 10/11 with Microsoft Edge WebView2 Runtime. The NSIS installer uses Tauri's WebView2 bootstrapper when needed, which can require an Internet connection.

Mac app ZIPs are supplied alongside DMGs as an alternative packaging route. Keep your previous working app until you have verified the new version on your computer.

## Native builds

Follow README prerequisites, then use the target appropriate to the build host:

```sh
pnpm desktop:build --ci --target x86_64-apple-darwin --bundles app,dmg
pnpm desktop:build --ci --target aarch64-apple-darwin --bundles app,dmg
pnpm desktop:build --ci --target x86_64-pc-windows-msvc --bundles nsis
```

The Windows command normally runs on Windows with Visual Studio C++ Build Tools. macOS can cross-compile the Windows NSIS package using cargo-xwin, LLVM/LLD, llvm-rc, CMake, Ninja and NSIS; use `--runner cargo-xwin`. Using cargo-xwin requires accepting Microsoft's SDK/CRT license. Build-only SDK/compiler caches are not part of the GitHub source folder or application. See [Tauri's Windows installer guide](https://v2.tauri.app/distribute/windows-installer/) and [cargo-xwin](https://github.com/rust-cross/cargo-xwin).

Native macOS outputs are under `src-tauri/target/TARGET/release/bundle/macos/`; installers under `bundle/dmg/` or `bundle/nsis/`. A build without `--target` uses `src-tauri/target/release/`. An app ZIP is also usable for Mac testing. The locally supplied DMGs use hdiutil with an Applications shortcut and do not require Finder scripting.

**Launch PlasmidCraft.command** is a macOS source-checkout helper: it opens an existing 0.34 app build or starts development when Node and the prerequisites are available. Installed users open the application directly.

## Signing a public Mac release

Obtain an Apple Developer account and Developer ID Application certificate, install it securely on the build Mac, and verify it with `security find-identity -v -p codesigning`. Configure `APPLE_SIGNING_IDENTITY` for Tauri. Configure notarization using the supported Apple ID/app-specific password/team ID or App Store Connect API-key variables in [Tauri's signing guide](https://v2.tauri.app/distribute/sign/macos/). Do not commit certificates, passwords or keys.

Rebuild **both architectures** with the signing/notarization configuration. Verify the resulting app with `codesign --verify --deep --strict --verbose=2`, check Gatekeeper with `spctl --assess --type execute --verbose=4`, and validate the notarization staple with `xcrun stapler validate`. For a separately created DMG, sign/notarize/staple that final DMG too; do not assume an app signature signs the disk image. Test a freshly downloaded artifact on another Mac. Generate new checksums after all signing/stapling changes.

## Signing a public Windows release

Obtain a trusted code-signing certificate/service and configure Tauri's Windows signing options (certificate thumbprint and timestamp service, or a custom signing command for the chosen service). See [Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/). Rebuild so both app and installer receive the intended signatures; verify Authenticode and timestamp on Windows with `Get-AuthenticodeSignature` and the Windows SDK's `signtool verify /pa /v`. Store credentials in protected CI secrets, never source. Recalculate checksums after signing. A signature does not guarantee immediate SmartScreen reputation.
