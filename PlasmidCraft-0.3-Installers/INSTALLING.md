# Install PlasmidCraft 0.3

Prepared by **Huiwang Ai at the University of Virginia with ChatGPT Codex**.
Contact: [huiwang.ai@virginia.edu](mailto:huiwang.ai@virginia.edu).

| Computer | Installer |
| --- | --- |
| Intel Mac | `PlasmidCraft-0.3.0-macOS-x64.dmg` |
| Apple Silicon Mac (M1 or newer) | `PlasmidCraft-0.3.0-macOS-arm64.dmg` |
| Windows 10/11 x64 | `PlasmidCraft-0.3.0-Windows-x64-setup.exe` |

Mac: open the matching DMG and drag **PlasmidCraft 0.3.app** into Applications.
The configured minimum is macOS 12.3. A matching ZIP is available as an alternative.
Windows: run the x64 installer. WebView2 is required; initial installation may
need Internet to download that runtime. Installed apps need no Node, Python,
Rust or Xcode.

These are test installers. Mac app signatures are ad-hoc, without Developer ID
notarization; Windows packages are unsigned. Verify the source and SHA-256 hash.
If macOS blocks a verified copy, use the app-specific Open Anyway control in
System Settings → Privacy & Security. Keep system protections enabled. Review
Windows unsigned-publisher prompts according to your organization's policy.
Apple Silicon and Windows installation/execution still need target-device tests.

Save documents as `.pcraft` and export feature-library backups before replacing
an existing app. There is no autosave/crash recovery. Sequence exchange formats
may omit application-specific evidence or design drafts.

Configure AI once through **AI → Accounts and Models…**. Mac API credentials
can be remembered in Keychain. Windows API keys are session-only in this version;
uncheck Remember on this device. Provider account/model eligibility applies.
Internal AI Operations runs supported tools on a copy and opens new unsaved designs.
External AI contains prompt preparation and pasted JSON proposal review together.

To import feature lists from an existing SnapGene installation, follow the
[feature import guide](../PlasmidCraft-0.3-GitHub/docs/FEATURE_CATALOG_AND_EXCHANGE.md).
Vendor feature lists and imported vendor patterns are not bundled.

See [BUILD_REPORT.txt](BUILD_REPORT.txt) for checks and remaining limitations,
and the [release guide](../PlasmidCraft-0.3-GitHub/docs/RELEASE.md) for signing.
