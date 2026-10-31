# Install PlasmidCraft 0.4

Prepared by **Huiwang Ai at the University of Virginia with ChatGPT Codex**. Contact: [huiwang.ai@virginia.edu](mailto:huiwang.ai@virginia.edu).

Installers are supplied with the 0.4 release or downloaded from the successful GitHub Actions run. Save your documents and export library backups before updating.

| Computer | File |
| --- | --- |
| Apple Silicon Mac (M1 or newer) | `PlasmidCraft-0.4.0-macOS-arm64.dmg` |
| Intel Mac | `PlasmidCraft-0.4.0-macOS-x64.dmg` |
| Windows 10/11 x64 | `PlasmidCraft-0.4.0-Windows-x64-setup.exe` |
| Debian/Ubuntu x86_64 | `PlasmidCraft-0.4.0-Linux-amd64.deb` |

**Mac:** open the matching DMG and drag **PlasmidCraft 0.4.app** to Applications. The configured minimum is macOS 12.3. These test bundles are ad-hoc signed and not notarized; app-specific verification prompts may appear. For a copy you have verified, use the app-specific Open Anyway control under System Settings → Privacy & Security. Keep general system protections enabled.

**Windows:** run the per-user installer. Microsoft Edge WebView2 Runtime is required and its initial installation may need Internet. The installer is unsigned; follow your organization's unsigned-app policy.

**Linux (Debian/Ubuntu, amd64):** install with `sudo apt install ./PlasmidCraft-0.4.0-Linux-amd64.deb`. APT resolves available runtime dependencies; Internet access may be needed. Launch PlasmidCraft from the applications menu. This package is intended for Debian-family distributions with compatible WebKitGTK 4.1 libraries.

## File icons and default application

Installed packages register `.pcraft`, `.pcprotein`, `.gb`, `.gbk`, `.genbank`, `.fa`, `.fasta`, `.fna`, `.faa`, `.pep`, `.dna` and `.ab1`. The document icon uses the PlasmidCraft mark on a folded page. Double-clicked files open as documents, including files opened while the app is running on macOS. Generic `.txt` files are intentionally not registered; open them through File → Open Sequence.

- **macOS:** in Finder, select a supported file → Get Info → Open with → PlasmidCraft → Change All. Repeat for each format you want to associate. Finder uses the registered document icon; cached icons can take time to refresh. Existing custom icons or Quick Look thumbnails may take precedence.
- **Windows:** right-click a supported file → Open with → Choose another app → PlasmidCraft → Always. You can also use Settings → Apps → Default apps. The selected PlasmidCraft document type supplies its file icon. Installation adds choices without replacing existing defaults.
- **Linux:** right-click a file → Properties → Open With and select PlasmidCraft as default. The Debian package installs MIME definitions and document icons and refreshes the system databases. Linux file icons follow MIME types and the desktop icon theme, independently of the default app, so their appearance can vary.

These registrations are installed with the app; launching a development build alone does not install file associations. Reinstall an updated package to receive metadata changes.
